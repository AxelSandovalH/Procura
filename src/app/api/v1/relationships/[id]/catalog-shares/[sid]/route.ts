import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("catalog.share")) throw Problem.forbidden("Requiere el permiso catalog.share");

  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const share = await tx.catalog_shares.findFirst({ where: { id: params.sid, relationship_id: params.id, supplier_organization_id: actor.organizationId } });
    if (!share) throw Problem.notFound();
    await tx.catalog_shares.update({ where: { id: share.id }, data: { is_active: false } });
    await audit(tx, { ...auditBase(actor), visibleTo: [share.buyer_organization_id, share.supplier_organization_id], action: "catalog_share.removed", resourceType: "catalog_share", resourceId: share.id });
  });
  return new Response(null, { status: 204 });
});
