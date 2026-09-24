import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireUser, requireActorForOrganization } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { hashToken } from "@/lib/auth/token";

const Body = z.object({
  // Requerido solo para invitaciones de tipo RELATIONSHIP: con qué organización propia se acepta.
  organization_id: z.uuid().optional(),
});

interface LookupRow {
  id: string; organization_id: string; kind: "MEMBERSHIP" | "RELATIONSHIP"; email: string | null;
  relationship_position: "BUYER" | "SUPPLIER" | null; auto_accept: boolean;
  status: "ACTIVE" | "EXPIRED" | "REVOKED"; expires_at: Date; max_uses: number; used_count: number;
  org_slug: string; org_display_name: string; role_names: string[];
}

export const POST = route(async (req, params) => {
  const user = await requireUser();
  const body = await json(req, (d) => Body.parse(d ?? {}));
  const hash = hashToken(params.token);

  const [invitation] = await withContext({ userId: user.id }, (tx) => tx.$queryRaw<LookupRow[]>`select * from app.lookup_invitation_by_hash(${hash})`);
  if (!invitation) throw Problem.notFound("Invitación no válida");
  if (invitation.status !== "ACTIVE") throw Problem.conflict(`La invitación está ${invitation.status.toLowerCase()}`);
  if (invitation.expires_at <= new Date()) throw Problem.conflict("La invitación expiró");
  if (invitation.used_count >= invitation.max_uses) throw Problem.conflict("La invitación agotó sus usos");

  if (invitation.kind === "MEMBERSHIP") return acceptMembership(invitation, user);
  return acceptRelationship(invitation, body.organization_id);
});

async function acceptMembership(invitation: LookupRow, user: { id: string; email: string }) {
  if (invitation.email && invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw Problem.forbidden("Esta invitación fue emitida para otro correo");
  }

  const result = await withContext({ userId: user.id, organizationId: invitation.organization_id }, async (tx) => {
    const existing = await tx.memberships.findUnique({ where: { user_id_organization_id: { user_id: user.id, organization_id: invitation.organization_id } } });
    if (existing && ["ACTIVE", "PENDING", "SUSPENDED"].includes(existing.status)) {
      throw Problem.conflict(`Ya tienes una membresía en esta organización (${existing.status})`);
    }

    const status = invitation.auto_accept ? "ACTIVE" : "PENDING";
    const membership = existing
      ? await tx.memberships.update({ where: { id: existing.id }, data: { status, requested_by: "ORGANIZATION", activated_at: status === "ACTIVE" ? new Date() : null, removed_at: null } })
      : await tx.memberships.create({ data: { user_id: user.id, organization_id: invitation.organization_id, status, requested_by: "ORGANIZATION", activated_at: status === "ACTIVE" ? new Date() : null } });

    if (status === "ACTIVE") {
      const roles = await tx.invitation_roles.findMany({ where: { invitation_id: invitation.id } });
      for (const r of roles) {
        await tx.role_assignments.create({ data: { organization_id: invitation.organization_id, membership_id: membership.id, role_id: r.role_id, scope_type: "ORGANIZATION" } });
      }
    }

    await tx.$executeRaw`select app.consume_invitation(${invitation.id}::uuid)`;
    await audit(tx, {
      actorType: "USER", actorId: user.id, membershipId: membership.id, organizationId: invitation.organization_id,
      action: status === "ACTIVE" ? "invitation.accepted" : "membership.requested", resourceType: "membership", resourceId: membership.id, resourceLabel: user.email,
    });
    return membership;
  });
  return NextResponse.json({ membership: result });
}

async function acceptRelationship(invitation: LookupRow, organizationId?: string) {
  if (!organizationId) throw Problem.badRequest("organization_id es requerido para aceptar una invitación de relación");
  if (organizationId === invitation.organization_id) throw Problem.badRequest("No puedes aceptar tu propia invitación");
  const actor = await requireActorForOrganization(organizationId);
  if (!actor.permissions.has("relationship.accept")) throw Problem.forbidden("Requiere el permiso relationship.accept");

  const isAcceptorSupplier = invitation.relationship_position === "SUPPLIER";
  const buyerId = isAcceptorSupplier ? invitation.organization_id : organizationId;
  const supplierId = isAcceptorSupplier ? organizationId : invitation.organization_id;

  const relationship = await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const created = await tx.relationships.create({
      data: {
        buyer_organization_id: buyerId, supplier_organization_id: supplierId,
        status: "ACTIVE", initiated_by_organization_id: invitation.organization_id, initiated_via: "INVITATION",
        accepted_at: new Date(), accepted_by_membership_id: actor.membershipId,
      },
    });
    // consume_invitation es SECURITY DEFINER: puede tocar la fila de invitations aunque
    // pertenezca a la otra organización (fuera del contexto RLS de esta transacción).
    await tx.$executeRaw`select app.consume_invitation(${invitation.id}::uuid)`;
    await audit(tx, { ...auditBase(actor), visibleTo: [buyerId, supplierId], action: "relationship.accepted", resourceType: "relationship", resourceId: created.id, changes: { buyer_organization_id: buyerId, supplier_organization_id: supplierId } });
    return created;
  });
  return NextResponse.json({ relationship });
}
