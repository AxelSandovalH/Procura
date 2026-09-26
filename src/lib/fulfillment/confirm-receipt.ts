import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

export interface ReceiptLineInput {
  delivery_line_id: string; quantity_received: number; quantity_accepted: number; quantity_rejected: number;
  discrepancy_type?: "SHORTAGE" | "OVERAGE" | "DAMAGED" | "WRONG_ITEM" | "QUALITY" | "OTHER"; discrepancy_notes?: string;
}

/**
 * Confirma la recepción de una entrega: valida invariante 7 (recibido = aceptado + rechazado,
 * recibido ≤ entregado), actualiza received/accepted_quantity de cada línea de orden, marca la
 * entrega RECEIVED y evalúa si la orden queda COMPLETED (todas las líneas cubiertas).
 */
export async function confirmReceipt(tx: Tx, deliveryId: string, input: { notes?: string; lines: ReceiptLineInput[] }, actorMembershipId: string | null) {
  const delivery = await tx.deliveries.findUniqueOrThrow({ where: { id: deliveryId }, include: { delivery_lines: true, receipts: true } });
  if (delivery.status !== "REGISTERED") throw Problem.conflict(`No se puede confirmar recepción en estado ${delivery.status}`);
  const receipt = delivery.receipts;
  if (!receipt || receipt.status !== "PENDING") throw Problem.conflict("Esta entrega ya tiene una recepción resuelta");

  const deliveryLineById = new Map(delivery.delivery_lines.map((l) => [l.id, l]));
  if (input.lines.length !== delivery.delivery_lines.length) throw Problem.badRequest("Debes confirmar todas las líneas de la entrega");

  let hasDiscrepancy = false;
  for (const line of input.lines) {
    const dl = deliveryLineById.get(line.delivery_line_id);
    if (!dl) throw Problem.badRequest(`delivery_line_id ${line.delivery_line_id} no pertenece a esta entrega`);
    if (Math.abs(line.quantity_received - (line.quantity_accepted + line.quantity_rejected)) > 1e-9) {
      throw Problem.badRequest("quantity_received debe ser igual a quantity_accepted + quantity_rejected");
    }
    if (line.quantity_received > Number(dl.quantity_delivered) + 1e-9) throw Problem.badRequest("quantity_received no puede exceder lo entregado");
    if (line.quantity_rejected > 0 && !line.discrepancy_type) throw Problem.badRequest("discrepancy_type es requerido cuando hay cantidad rechazada");
    if (line.quantity_rejected > 0) hasDiscrepancy = true;
  }

  await tx.receipt_lines.createMany({
    data: input.lines.map((l) => ({
      receipt_id: receipt.id, buyer_organization_id: delivery.buyer_organization_id, supplier_organization_id: delivery.supplier_organization_id,
      delivery_line_id: l.delivery_line_id, quantity_received: l.quantity_received, quantity_accepted: l.quantity_accepted, quantity_rejected: l.quantity_rejected,
      discrepancy_type: l.discrepancy_type, discrepancy_notes: l.discrepancy_notes,
    })),
  });
  for (const l of input.lines) {
    const dl = deliveryLineById.get(l.delivery_line_id)!;
    await tx.order_lines.update({ where: { id: dl.order_line_id }, data: { received_quantity: { increment: l.quantity_received }, accepted_quantity: { increment: l.quantity_accepted } } });
  }

  await tx.deliveries.update({ where: { id: delivery.id }, data: { status: "RECEIVED" } });
  const updatedReceipt = await tx.receipts.update({
    where: { id: receipt.id },
    data: { status: hasDiscrepancy ? "CONFIRMED_WITH_DISCREPANCIES" : "CONFIRMED", confirmed_at: new Date(), confirmed_by_membership_id: actorMembershipId, notes: input.notes },
  });

  const orderLines = await tx.order_lines.findMany({ where: { order_id: delivery.order_id } });
  const fullyReceived = orderLines.every((l) => Number(l.received_quantity) >= Number(l.quantity) - 1e-9);
  let orderCompleted = false;
  if (fullyReceived) {
    await tx.orders.update({ where: { id: delivery.order_id }, data: { status: "COMPLETED", completed_at: new Date(), completion_mode: "FULL" } });
    const order = await tx.orders.findUniqueOrThrow({ where: { id: delivery.order_id }, select: { requisition_id: true } });
    await tx.requisitions.update({ where: { id: order.requisition_id }, data: { status: "RESOLVED", resolved_at: new Date() } });
    orderCompleted = true;
  }
  return { receipt: updatedReceipt, orderCompleted, hasDiscrepancy };
}
