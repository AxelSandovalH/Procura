import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

/** Constancia (auditoría, eventos y aviso al proveedor) de que una cotización se aceptó y generó su orden. */
export async function announceOrderCreated(tx: Tx, actor: Actor, quotationId: string, orderId: string) {
  const q = await tx.quotations.findUniqueOrThrow({ where: { id: quotationId } });
  const order = await tx.orders.findUniqueOrThrow({ where: { id: orderId } });
  const visibleTo = [q.buyer_organization_id, q.supplier_organization_id];
  await audit(tx, { ...auditBase(actor), visibleTo, action: "quotation.accepted", resourceType: "quotation", resourceId: q.id, resourceLabel: q.quotation_number });
  await audit(tx, { ...auditBase(actor), visibleTo, action: "order.created", resourceType: "order", resourceId: order.id, resourceLabel: order.order_number });
  await emitEvent(tx, {
    type: "quotation.accepted", aggregateType: "quotation", aggregateId: q.id, actor,
    recipients: [
      { organizationId: q.buyer_organization_id, perspective: "BUYER", payload: { quotation: { id: q.id, quotation_number: q.quotation_number } } },
      { organizationId: q.supplier_organization_id, perspective: "SUPPLIER", payload: { quotation: { id: q.id, quotation_number: q.quotation_number } } },
    ],
  });
  await emitEvent(tx, {
    type: "order.created", aggregateType: "order", aggregateId: order.id, actor,
    recipients: [
      { organizationId: q.buyer_organization_id, perspective: "BUYER", payload: { order: { id: order.id, order_number: order.order_number, requisition_id: order.requisition_id, total_minor: order.total_minor } } },
      { organizationId: q.supplier_organization_id, perspective: "SUPPLIER", payload: { order: { id: order.id, order_number: order.order_number, total_minor: order.total_minor } } },
    ],
  });
  await notifyPermissionHolders(tx, { organizationId: q.supplier_organization_id, permission: "order.confirm", type: "order.created", title: `Nueva orden ${order.order_number}`, resourceType: "order", resourceId: order.id });
  return { quotation: q, order };
}
