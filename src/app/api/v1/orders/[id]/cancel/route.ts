import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent } from "@/lib/events/emit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });
const CANCELLABLE: readonly string[] = ["PENDING_CONFIRMATION", "CONFIRMED", "IN_PROCESS"];

/** Cancelable por comprador (order.cancel) o por el proveedor directamente (regla 9). Bloqueado si ya hay recepción confirmada. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));
  const order = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!o) throw Problem.notFound();
    if (!actor.permissions.has("order.cancel")) throw Problem.forbidden();
    if (!CANCELLABLE.includes(o.status)) throw Problem.conflict(`No se puede cancelar en estado ${o.status}`);

    const confirmedReceipts = await tx.receipts.count({ where: { order_id: o.id, status: { in: ["CONFIRMED", "CONFIRMED_WITH_DISCREPANCIES"] } } });
    if (confirmedReceipts > 0) throw Problem.conflict("Ya hay recepciones confirmadas; usa close-short en vez de cancelar");

    await tx.deliveries.updateMany({ where: { order_id: o.id, status: "REGISTERED" }, data: { status: "CANCELLED", cancelled_at: new Date(), cancel_reason: "Orden cancelada" } });
    const updated = await tx.orders.update({ where: { id: o.id }, data: { status: "CANCELLED", cancelled_at: new Date(), cancelled_by_membership_id: actor.membershipId, cancelled_by_organization_id: actor.organizationId, cancel_reason: reason } });
    // requisitions es INTERNAL del comprador; si cancela el proveedor, no tiene contexto RLS para tocarla.
    await tx.$executeRaw`select app.reopen_requisition_after_order_setback(${o.id}::uuid, ${actor.organizationId}::uuid)`;
    await audit(tx, { ...auditBase(actor), visibleTo: [o.buyer_organization_id, o.supplier_organization_id], action: "order.cancelled", resourceType: "order", resourceId: o.id, resourceLabel: o.order_number, reason });
    await emitEvent(tx, { type: "order.cancelled", aggregateType: "order", aggregateId: o.id, actor, recipients: [{ organizationId: o.buyer_organization_id, perspective: "BUYER" as const, payload: { order: { id: o.id, order_number: o.order_number }, reason } }, { organizationId: o.supplier_organization_id, perspective: "SUPPLIER" as const, payload: { order: { id: o.id, order_number: o.order_number }, reason } }] });
    return updated;
  });
  return NextResponse.json(order);
});
