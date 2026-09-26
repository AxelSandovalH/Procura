import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const rfq = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.quotation_requests.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    authorize(actor, "rfq.issue", { buyer_organization_id: r.buyer_organization_id, supplier_organization_id: r.supplier_organization_id });
    if (!["SENT", "VIEWED", "QUOTED"].includes(r.status)) throw Problem.conflict(`No se puede retirar en estado ${r.status}`);

    await tx.quotations.updateMany({ where: { rfq_id: r.id, status: "SUBMITTED" }, data: { status: "REJECTED", rejected_at: new Date(), rejected_reason: "RFQ retirada por el comprador" } });
    const updated = await tx.quotation_requests.update({ where: { id: r.id }, data: { status: "WITHDRAWN", withdrawn_at: new Date() } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "rfq.withdrawn", resourceType: "quotation_request", resourceId: r.id, resourceLabel: r.rfq_number });
    return updated;
  });
  return NextResponse.json(rfq);
});
