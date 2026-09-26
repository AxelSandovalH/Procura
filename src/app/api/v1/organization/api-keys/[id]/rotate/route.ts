import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { generateApiKey, assertRolesAllowed } from "@/lib/auth/api-keys";

/** Crea una key nueva con los mismos roles y revoca la anterior en la misma transacción. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "api_key.manage");
  if (actor.type !== "USER") throw Problem.forbidden("Las API keys solo las gestionan personas");
  const { secret, hash, prefix } = generateApiKey();

  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const old = await tx.api_keys.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { api_key_roles: true } });
    if (!old) throw Problem.notFound();
    if (old.revoked_at) throw Problem.conflict("No se puede rotar una API key revocada");
    const roleIds = old.api_key_roles.map((r) => r.role_id);
    await assertRolesAllowed(tx, actor, roleIds);
    await tx.api_keys.update({ where: { id: old.id }, data: { revoked_at: new Date() } });
    const next = await tx.api_keys.create({
      data: { organization_id: actor.organizationId, name: old.name, key_prefix: prefix, key_hash: hash, created_by_membership_id: actor.membershipId, expires_at: old.expires_at, api_key_roles: { create: roleIds.map((role_id) => ({ role_id, organization_id: actor.organizationId })) } },
    });
    await audit(tx, { ...auditBase(actor), action: "api_key.rotated", resourceType: "api_key", resourceId: next.id, resourceLabel: next.name, changes: { replaces: old.id } });
    return next;
  });
  return NextResponse.json({ id: created.id, name: created.name, key_prefix: created.key_prefix, expires_at: created.expires_at, created_at: created.created_at, secret }, { status: 201 });
});
