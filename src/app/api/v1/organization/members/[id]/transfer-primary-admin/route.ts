import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

/** Solo el administrador principal actual puede transferir el rol (no basta con el permiso). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "admin.transfer_primary");

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const current = await tx.memberships.findFirst({ where: { organization_id: actor.organizationId, is_primary_admin: true } });
    if (!current || current.id !== actor.membershipId) throw Problem.forbidden("Solo el administrador principal actual puede transferir el rol");

    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId, status: "ACTIVE" }, include: { users: { select: { email: true } } } });
    if (!target) throw Problem.badRequest("El destino debe ser un miembro activo de esta organización");
    if (target.id === current.id) throw Problem.badRequest("Ya eres el administrador principal");

    await tx.memberships.update({ where: { id: current.id }, data: { is_primary_admin: false } });
    const updated = await tx.memberships.update({ where: { id: target.id }, data: { is_primary_admin: true } });

    const adminRole = await tx.roles.findFirst({ where: { organization_id: actor.organizationId, name: "Administrador" } });
    if (adminRole) {
      const already = await tx.role_assignments.findFirst({ where: { membership_id: target.id, role_id: adminRole.id, scope_type: "ORGANIZATION", revoked_at: null } });
      if (!already) await tx.role_assignments.create({ data: { organization_id: actor.organizationId, membership_id: target.id, role_id: adminRole.id, scope_type: "ORGANIZATION", granted_by_membership_id: actor.membershipId } });
    }

    await audit(tx, { ...auditBase(actor), action: "admin.transferred_primary", resourceType: "membership", resourceId: updated.id, resourceLabel: target.users.email, changes: { from: current.id, to: target.id } });
    return updated;
  });
  return NextResponse.json(result);
});
