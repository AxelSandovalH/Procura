import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

/** Revoca (no borra): deja de autenticar de inmediato y se conserva para la auditoría. */
export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "api_key.manage");
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const key = await tx.api_keys.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!key) throw Problem.notFound();
    if (key.revoked_at) throw Problem.conflict("La API key ya estaba revocada");
    await tx.api_keys.update({ where: { id: key.id }, data: { revoked_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "api_key.revoked", resourceType: "api_key", resourceId: key.id, resourceLabel: key.name });
  });
  return new Response(null, { status: 204 });
});
