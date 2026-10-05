import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { loadAuditFeed } from "@/lib/audit-feed";

/** Línea de tiempo de una requisición: ella, sus peticiones de cotización, cotizaciones, orden y entregas. */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.read");
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } });
    if (!r) throw Problem.notFound();
    const rfqs = await tx.quotation_requests.findMany({ where: { requisition_id: r.id }, select: { id: true } });
    const rfqIds = rfqs.map((x) => x.id);
    const [quotes, orders] = await Promise.all([
      rfqIds.length ? tx.quotations.findMany({ where: { rfq_id: { in: rfqIds } }, select: { id: true } }) : [],
      tx.orders.findMany({ where: { requisition_id: r.id }, select: { id: true } }),
    ]);
    const orderIds = orders.map((x) => x.id);
    const deliveries = orderIds.length ? await tx.deliveries.findMany({ where: { order_id: { in: orderIds } }, select: { id: true } }) : [];
    const receipts = orderIds.length ? await tx.receipts.findMany({ where: { order_id: { in: orderIds } }, select: { id: true } }) : [];
    const ids = [r.id, ...rfqIds, ...quotes.map((x) => x.id), ...orderIds, ...deliveries.map((x) => x.id), ...receipts.map((x) => x.id)];
    return loadAuditFeed(tx, actor.organizationId, { resource_id: { in: ids } });
  });
  return NextResponse.json({ data });
});
