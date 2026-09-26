import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

/** La requisición vuelve a SENT: Compras puede buscar otra solución (regla 8). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));
  const order = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!o) throw Problem.notFound();
    if (!actor.permissions.has("order.confirm")) throw Problem.forbidden();
    if (o.status !== "PENDING_CONFIRMATION") throw Problem.conflict(`No se puede rechazar en estado ${o.status}`);

    const updated = await tx.orders.update({ where: { id: o.id }, data: { status: "REJECTED", rejected_at: new Date(), rejected_by_membership_id: actor.membershipId, rejected_reason: reason } });
    await tx.quotations.update({ where: { id: o.quotation_id }, data: { status: "REJECTED", rejected_at: new Date(), rejected_reason: `Orden rechazada por el proveedor: ${reason}` } });
    // requisitions es INTERNAL del comprador; el proveedor no tiene contexto RLS para tocarla directamente.
    await tx.$executeRaw`select app.reopen_requisition_after_order_setback(${o.id}::uuid, ${actor.organizationId}::uuid)`;
    await audit(tx, { ...auditBase(actor), visibleTo: [o.buyer_organization_id, o.supplier_organization_id], action: "order.rejected", resourceType: "order", resourceId: o.id, resourceLabel: o.order_number, reason });
    await emitEvent(tx, { type: "order.rejected", aggregateType: "order", aggregateId: o.id, actor, recipients: [{ organizationId: o.buyer_organization_id, perspective: "BUYER" as const, payload: { order: { id: o.id, order_number: o.order_number }, reason } }] });
    await notifyPermissionHolders(tx, { organizationId: o.buyer_organization_id, permission: "rfq.issue", type: "order.rejected", title: `${o.order_number} fue rechazada por el proveedor`, body: reason, resourceType: "order", resourceId: o.id });
    return updated;
  });
  return NextResponse.json(order);
});
