import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize, authorizeAny } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { generateToken } from "@/lib/auth/token";
import { env } from "@/lib/env";

const Base = z.object({
  auto_accept: z.boolean().default(false),
  expires_in_days: z.number().int().min(1).max(90).default(7),
  max_uses: z.number().int().min(1).max(1000).default(1),
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

  return NextResponse.json({ ...invitation, token, url: `${env().APP_URL}/invitations/${token}` }, { status: 201 });
});
