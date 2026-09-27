import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize, authorizeAny } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { generateToken } from "@/lib/auth/token";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/http/rate-limit";
import { sendEmailNow } from "@/lib/email/outbox";
import { renderInvitationEmail } from "@/lib/email/templates";

const Base = z.object({
  auto_accept: z.boolean().default(false),
  expires_in_days: z.number().int().min(1).max(90).default(7),
  max_uses: z.number().int().min(1).max(1000).default(1),
  // Si la invitación lleva `email`, Procura puede enviarla por correo (requiere Resend configurado).
  send_email: z.boolean().default(false),
});
const MembershipInvite = Base.extend({
  kind: z.literal("MEMBERSHIP"),
  email: z.email().optional(),
  role_ids: z.array(z.uuid()).default([]),
});
const RelationshipInvite = Base.extend({
  kind: z.literal("RELATIONSHIP"),
  relationship_position: z.enum(["BUYER", "SUPPLIER"]),
});
const Create = z.discriminatedUnion("kind", [MembershipInvite, RelationshipInvite]);

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorizeAny(actor, ["member.invite", "relationship.request"]);
  const invitations = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.invitations.findMany({
      where: { organization_id: actor.organizationId },
      orderBy: { created_at: "desc" },
      select: { id: true, kind: true, email: true, relationship_position: true, auto_accept: true, expires_at: true, max_uses: true, used_count: true, status: true, created_at: true },
    }),
  );
  return NextResponse.json({ data: invitations });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Create.parse(d));
  authorize(actor, body.kind === "MEMBERSHIP" ? "member.invite" : "relationship.request");

  const { token, hash } = generateToken();
  const expiresAt = new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000);

  const invitation = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    let roleIds: string[] = [];
    if (body.kind === "MEMBERSHIP" && body.role_ids.length > 0) {
      const roles = await tx.roles.findMany({ where: { id: { in: body.role_ids }, organization_id: actor.organizationId, is_active: true }, include: { role_permissions: true } });
      if (roles.length !== body.role_ids.length) throw Problem.badRequest("Uno o más role_ids no existen o están inactivos");
      const escalates = roles.some((r) => r.role_permissions.some((p) => !actor.permissions.has(p.permission_code as never)));
      if (escalates) throw Problem.forbidden("No puedes invitar con un rol que otorgue permisos que tú mismo no tienes");
      roleIds = roles.map((r) => r.id);
    }

    const created = await tx.invitations.create({
      data: {
        organization_id: actor.organizationId,
        kind: body.kind,
        token_hash: hash,
        email: body.kind === "MEMBERSHIP" ? body.email : undefined,
        relationship_position: body.kind === "RELATIONSHIP" ? body.relationship_position : undefined,
        auto_accept: body.auto_accept,
        expires_at: expiresAt,
        max_uses: body.max_uses,
        created_by_membership_id: actor.membershipId,
        ...(roleIds.length > 0 ? { invitation_roles: { create: roleIds.map((role_id) => ({ role_id, organization_id: actor.organizationId })) } } : {}),
      },
    });
    await audit(tx, { ...auditBase(actor), action: "invitation.created", resourceType: "invitation", resourceId: created.id, resourceLabel: body.kind, changes: { kind: body.kind } });
    return created;
  });

  const url = `${env().APP_URL}/invitations/${token}`;
  let emailSent = false;
  if (body.send_email && body.kind === "MEMBERSHIP" && body.email) {
    await rateLimit("invitation-email", actor.userId ?? actor.organizationId, { windowSeconds: 3600, max: 60 });
    const ctx = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      const [org, inviter, roles] = await Promise.all([
        tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { display_name: true } }),
        actor.userId ? tx.$queryRaw<{ full_name: string }[]>`select full_name from users where id = ${actor.userId}::uuid` : Promise.resolve([]),
        tx.roles.findMany({ where: { organization_id: actor.organizationId, id: { in: body.role_ids } }, select: { name: true } }),
      ]);
      return { org: org.display_name, inviter: inviter[0]?.full_name || org.display_name, roles: roles.map((r) => r.name) };
    });
    emailSent = await sendEmailNow(body.email, renderInvitationEmail({ inviter: ctx.inviter, orgName: ctx.org, roleNames: ctx.roles, url, expiresAt }, env().APP_URL));
  }
  return NextResponse.json({ ...invitation, token, url, email_sent: emailSent }, { status: 201 });
});
