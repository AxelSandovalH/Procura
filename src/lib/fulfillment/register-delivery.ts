import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

export interface DeliveryLineInput { order_line_id: string; quantity_delivered: number; notes?: string }

/**
 * Registra una entrega del proveedor: valida invariante 6 (Σ entregado ≤ cantidad ordenada),
 * crea Delivery + DeliveryLine[] + Receipt(PENDING), actualiza delivered_quantity de cada línea
 * y pasa la orden a IN_PROCESS si estaba CONFIRMED (S-05).
 */
export async function registerDelivery(
  tx: Tx,
  orderId: string,
  input: { delivered_at: Date; location_id?: string; carrier?: string; tracking_ref?: string; notes?: string; lines: DeliveryLineInput[] },
  actorMembershipId: string | null,
) {
  const order = await tx.orders.findUniqueOrThrow({ where: { id: orderId }, include: { order_lines: true } });
  if (order.status !== "CONFIRMED" && order.status !== "IN_PROCESS") throw Problem.conflict(`No se puede registrar entrega en estado ${order.status}`);

  const orderLineById = new Map(order.order_lines.map((l) => [l.id, l]));
  for (const line of input.lines) {
    const ol = orderLineById.get(line.order_line_id);
    if (!ol || ol.order_id !== orderId) throw Problem.badRequest(`order_line_id ${line.order_line_id} no pertenece a esta orden`);
    if (line.quantity_delivered <= 0) throw Problem.badRequest("quantity_delivered debe ser mayor a 0");
    const alreadyDelivered = Number(ol.delivered_quantity);
    if (alreadyDelivered + line.quantity_delivered > Number(ol.quantity) + 1e-9) {
      throw Problem.conflict(`La línea "${ol.name}" excede lo ordenado: ya entregado ${alreadyDelivered}, ordenado ${ol.quantity}`);
    }
  }

  const maxNumber = await tx.deliveries.aggregate({ where: { order_id: orderId }, _max: { delivery_number: true } });
  const delivery = await tx.deliveries.create({
    data: {
      order_id: orderId, relationship_id: order.relationship_id, buyer_organization_id: order.buyer_organization_id, supplier_organization_id: order.supplier_organization_id,
      delivery_number: (maxNumber._max.delivery_number ?? 0) + 1, delivered_at: input.delivered_at, location_id: input.location_id,
      carrier: input.carrier, tracking_ref: input.tracking_ref, notes: input.notes, registered_by_membership_id: actorMembershipId,
    },
  });

  await tx.delivery_lines.createMany({
    data: input.lines.map((l) => ({ delivery_id: delivery.id, buyer_organization_id: order.buyer_organization_id, supplier_organization_id: order.supplier_organization_id, order_line_id: l.order_line_id, quantity_delivered: l.quantity_delivered, notes: l.notes })),
  });
  for (const l of input.lines) {
    await tx.order_lines.update({ where: { id: l.order_line_id }, data: { delivered_quantity: { increment: l.quantity_delivered } } });
  }

  await tx.receipts.create({ data: { delivery_id: delivery.id, order_id: orderId, buyer_organization_id: order.buyer_organization_id, supplier_organization_id: order.supplier_organization_id } });

  if (order.status === "CONFIRMED") {
    await tx.orders.update({ where: { id: orderId }, data: { status: "IN_PROCESS", started_at: new Date(), started_by_membership_id: actorMembershipId } });
  }
  return delivery;
}
