import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";
import { publicInvoice } from "@/lib/billing/invoices";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

/** El comprador rechaza una factura recibida. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "invoice.review");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const i = await tx.supplier_invoices.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!i) throw Problem.notFound();
    if (i.status === "REJECTED") throw Problem.conflict("La factura ya está rechazada.");
    if ((await tx.expense_invoices.count({ where: { supplier_invoice_id: i.id } })) > 0) throw Problem.conflict("La factura está ligada a un gasto; desliga el gasto antes de rechazarla.");
    const updated = await tx.supplier_invoices.update({ where: { id: i.id }, data: { status: "REJECTED", reviewed_by_membership_id: actor.membershipId, reviewed_at: new Date(), review_reason: reason ?? null, updated_at: new Date() } });
    const order = await tx.orders.findUniqueOrThrow({ where: { id: i.order_id }, select: { order_number: true } });
    const visibleTo = [i.buyer_organization_id, i.supplier_organization_id];
    await audit(tx, { ...auditBase(actor), visibleTo, action: "invoice.rejected", resourceType: "order", resourceId: i.order_id, resourceLabel: order.order_number, reason, metadata: { invoice_id: i.id, fiscal_uuid: i.fiscal_uuid } });
    const payload = { invoice: { id: i.id, fiscal_uuid: i.fiscal_uuid, status: "REJECTED" }, order: { id: i.order_id, order_number: order.order_number }, reason: reason ?? null };
    await emitEvent(tx, { type: "invoice.rejected", aggregateType: "order", aggregateId: i.order_id, actor, recipients: [
      { organizationId: i.buyer_organization_id, perspective: "BUYER", payload }, { organizationId: i.supplier_organization_id, perspective: "SUPPLIER", payload }] });
    await notifyPermissionHolders(tx, { organizationId: i.supplier_organization_id, permission: "invoice.submit", type: "invoice.rejected", title: `El comprador rechazó tu factura de ${order.order_number}`, body: reason, resourceType: "order", resourceId: i.order_id });
    return updated;
  });
  return NextResponse.json(publicInvoice(out));
});
