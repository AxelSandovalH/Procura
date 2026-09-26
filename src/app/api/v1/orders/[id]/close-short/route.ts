import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));
  const order = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!o) throw Problem.notFound();
    if (!actor.permissions.has("order.close_short")) throw Problem.forbidden();
    if (o.status !== "CONFIRMED" && o.status !== "IN_PROCESS") throw Problem.conflict(`No se puede cerrar corto en estado ${o.status}`);
    const confirmedReceipts = await tx.receipts.count({ where: { order_id: o.id, status: { in: ["CONFIRMED", "CONFIRMED_WITH_DISCREPANCIES"] } } });
    if (confirmedReceipts === 0) throw Problem.conflict("Se requiere al menos una recepción confirmada para cerrar corto");

    const updated = await tx.orders.update({ where: { id: o.id }, data: { status: "COMPLETED", completed_at: new Date(), completion_mode: "CLOSED_SHORT", completion_reason: reason } });
    await tx.requisitions.update({ where: { id: o.requisition_id }, data: { status: "RESOLVED", resolved_at: new Date() } });
    await audit(tx, { ...auditBase(actor), visibleTo: [o.buyer_organization_id, o.supplier_organization_id], action: "order.completed", resourceType: "order", resourceId: o.id, resourceLabel: o.order_number, reason, metadata: { completion_mode: "CLOSED_SHORT" } });
    return updated;
  });
  return NextResponse.json(order);
});
