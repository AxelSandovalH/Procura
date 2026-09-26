import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const order = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!o) throw Problem.notFound();
    if (!actor.permissions.has("order.confirm")) throw Problem.forbidden();
    if (o.status !== "PENDING_CONFIRMATION") throw Problem.conflict(`No se puede confirmar en estado ${o.status}`);
    const updated = await tx.orders.update({ where: { id: o.id }, data: { status: "CONFIRMED", confirmed_at: new Date(), confirmed_by_membership_id: actor.membershipId } });
    await audit(tx, { ...auditBase(actor), visibleTo: [o.buyer_organization_id, o.supplier_organization_id], action: "order.confirmed", resourceType: "order", resourceId: o.id, resourceLabel: o.order_number });
    await emitEvent(tx, { type: "order.confirmed", aggregateType: "order", aggregateId: o.id, actor, recipients: [{ organizationId: o.buyer_organization_id, perspective: "BUYER" as const, payload: { order: { id: o.id, order_number: o.order_number } } }, { organizationId: o.supplier_organization_id, perspective: "SUPPLIER" as const, payload: { order: { id: o.id, order_number: o.order_number } } }] });
    await notifyPermissionHolders(tx, { organizationId: o.buyer_organization_id, permission: "rfq.issue", type: "order.confirmed", title: `${o.order_number} fue confirmada por el proveedor`, resourceType: "order", resourceId: o.id });
    return updated;
  });
  return NextResponse.json(order);
});
