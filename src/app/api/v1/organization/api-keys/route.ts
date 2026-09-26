import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { generateApiKey, assertRolesAllowed } from "@/lib/auth/api-keys";

const Create = z.object({
  name: z.string().trim().min(1).max(80),
  role_ids: z.array(z.uuid()).min(1),
  expires_in_days: z.number().int().min(1).max(730).optional(),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "api_key.manage");
  const keys = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.api_keys.findMany({
      where: { organization_id: actor.organizationId }, orderBy: { created_at: "desc" },
      select: { id: true, name: true, key_prefix: true, last_used_at: true, expires_at: true, revoked_at: true, created_at: true, api_key_roles: { select: { roles: { select: { id: true, name: true } } } } },
    }),
  );
  return NextResponse.json({ data: keys.map(({ api_key_roles, ...k }) => ({ ...k, roles: api_key_roles.map((r) => r.roles) })) });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "api_key.manage");
  if (actor.type !== "USER") throw Problem.forbidden("Las API keys solo las gestionan personas");
  const body = await json(req, (d) => Create.parse(d));
  const { secret, hash, prefix } = generateApiKey();

  const key = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await assertRolesAllowed(tx, actor, body.role_ids);
    const created = await tx.api_keys.create({
      data: {
        organization_id: actor.organizationId, name: body.name, key_prefix: prefix, key_hash: hash, created_by_membership_id: actor.membershipId,
        expires_at: body.expires_in_days ? new Date(Date.now() + body.expires_in_days * 86_400_000) : null,
        api_key_roles: { create: body.role_ids.map((role_id) => ({ role_id, organization_id: actor.organizationId })) },
      },
    });
    await audit(tx, { ...auditBase(actor), action: "api_key.created", resourceType: "api_key", resourceId: created.id, resourceLabel: created.name, changes: { role_ids: body.role_ids } });
    return created;
  });
  return NextResponse.json({ id: key.id, name: key.name, key_prefix: key.key_prefix, expires_at: key.expires_at, created_at: key.created_at, secret }, { status: 201 });
});
