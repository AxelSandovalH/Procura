import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext, type Tx } from "@/lib/db/client";
import { availableOrderActions } from "@/lib/sourcing/state";

export async function loadOrder(tx: Tx, id: string, orgId: string) {
  const o = await tx.orders.findFirst({
    where: { id, OR: [{ buyer_organization_id: orgId }, { supplier_organization_id: orgId }] },
    include: {
      order_lines: { orderBy: { line_number: "asc" } },
      organizations_orders_buyer_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
      organizations_orders_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
    },
  });
  if (!o) throw Problem.notFound();
  return o;
}

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("order.read")) throw Problem.forbidden();
  const { order: o, hasConfirmedReceipt } = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const order = await loadOrder(tx, params.id, actor.organizationId);
    const count = await tx.receipts.count({ where: { order_id: order.id, status: { in: ["CONFIRMED", "CONFIRMED_WITH_DISCREPANCIES"] } } });
    return { order, hasConfirmedReceipt: count > 0 };
  });
  const isBuyer = o.buyer_organization_id === actor.organizationId;
  return NextResponse.json({
    id: o.id, order_number: o.order_number, status: o.status, version: o.version, perspective: isBuyer ? "BUYER" : "SUPPLIER",
    requisition_id: isBuyer ? o.requisition_id : undefined,
    buyer: o.organizations_orders_buyer_organization_idToorganizations, supplier: o.organizations_orders_supplier_organization_idToorganizations,
    my_reference: isBuyer ? o.buyer_reference : o.supplier_reference, counterpart_reference: isBuyer ? o.supplier_reference : o.buyer_reference,
    currency: o.currency, subtotal_minor: o.subtotal_minor, tax_minor: o.tax_minor, total_minor: o.total_minor,
    payment_terms: o.payment_terms, delivery_terms: o.delivery_terms, required_date: o.required_date,
    lines: o.order_lines,
    cancel_reason: o.cancel_reason, rejected_reason: o.rejected_reason, completion_mode: o.completion_mode,
    created_at: o.created_at, confirmed_at: o.confirmed_at, started_at: o.started_at, cancelled_at: o.cancelled_at, completed_at: o.completed_at,
    available_actions: availableOrderActions(o, actor, hasConfirmedReceipt),
  });
});
