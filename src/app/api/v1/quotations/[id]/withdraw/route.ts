import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const quotation = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden();
    if (q.status !== "SUBMITTED") throw Problem.conflict(`No se puede retirar en estado ${q.status}`);
    const updated = await tx.quotations.update({ where: { id: q.id }, data: { status: "WITHDRAWN", withdrawn_at: new Date() } });
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation.withdrawn", resourceType: "quotation", resourceId: q.id, resourceLabel: q.quotation_number });
    return updated;
  });
  return NextResponse.json(quotation);
});
