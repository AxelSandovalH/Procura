import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { acceptQuotationAndCreateOrder } from "@/lib/sourcing/create-order";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.accept")) throw Problem.forbidden();
    // OD-14: NOT_SELECTED no es terminal — puede reabrirse si sigue vigente.
    if (q.status !== "SUBMITTED" && q.status !== "NOT_SELECTED") throw Problem.conflict(`No se puede aceptar en estado ${q.status}`);
    if (q.valid_until && q.valid_until < new Date(new Date().toDateString())) throw Problem.conflict("La cotización ya expiró");

    const requisition = await tx.quotation_requests.findUniqueOrThrow({ where: { id: q.rfq_id }, select: { requisition_id: true } });
    const existingLiveOrder = await tx.orders.findFirst({ where: { requisition_id: requisition.requisition_id, status: { notIn: ["REJECTED", "CANCELLED"] } } });
    if (existingLiveOrder) throw Problem.conflict("Esta requisición ya tiene una orden viva");

    const order = await acceptQuotationAndCreateOrder(tx, q.id, actor.membershipId);
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation.accepted", resourceType: "quotation", resourceId: q.id, resourceLabel: q.quotation_number });
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "order.created", resourceType: "order", resourceId: order.id, resourceLabel: order.order_number });
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
    return { quotation: await tx.quotations.findUniqueOrThrow({ where: { id: q.id } }), order };
  });
  return NextResponse.json(result);
});
