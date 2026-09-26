import type { quotations, orders, quotation_requests } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";

export function availableQuotationActions(q: quotations, actor: Actor): string[] {
  const actions: string[] = [];
  const isSupplier = q.supplier_organization_id === actor.organizationId;
  const isBuyer = q.buyer_organization_id === actor.organizationId;
  const p = actor.permissions;

  if (isSupplier) {
    if (q.status === "DRAFT" && p.has("quotation.submit")) actions.push("update", "submit");
    if (q.status === "SUBMITTED" && p.has("quotation.submit")) actions.push("withdraw", "revise");
    if ((q.status === "SUBMITTED" || q.status === "EXPIRED") && p.has("quotation.submit")) actions.push("extend");
    if (p.has("quotation.read_private")) actions.push("private");
  }
  if (isBuyer) {
    if ((q.status === "SUBMITTED" || q.status === "NOT_SELECTED") && p.has("quotation.accept")) actions.push("accept", "reject");
  }
  return actions;
}

export function availableRfqActions(r: quotation_requests, actor: Actor): string[] {
  const actions: string[] = [];
  const isSupplier = r.supplier_organization_id === actor.organizationId;
  const isBuyer = r.buyer_organization_id === actor.organizationId;
  const p = actor.permissions;
  if (isSupplier) {
    if (["SENT", "VIEWED"].includes(r.status) && p.has("rfq.decline")) actions.push("decline");
    if (["SENT", "VIEWED", "QUOTED"].includes(r.status) && p.has("quotation.submit")) actions.push("submit_quotation");
  }
  if (isBuyer && ["SENT", "VIEWED", "QUOTED"].includes(r.status) && p.has("rfq.issue")) actions.push("withdraw");
  return actions;
}

const LIVE_ORDER_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "IN_PROCESS"] as const;

export function availableOrderActions(o: orders, actor: Actor, hasConfirmedReceipt: boolean): string[] {
  const actions: string[] = [];
  const isSupplier = o.supplier_organization_id === actor.organizationId;
  const isBuyer = o.buyer_organization_id === actor.organizationId;
  const p = actor.permissions;

  if (isSupplier) {
    if (o.status === "PENDING_CONFIRMATION" && p.has("order.confirm")) actions.push("confirm", "reject");
    if (o.status === "CONFIRMED" && p.has("order.start")) actions.push("start");
    if ((o.status === "CONFIRMED" || o.status === "IN_PROCESS") && p.has("delivery.register")) actions.push("register_delivery");
  }
  if (isBuyer && o.status === "IN_PROCESS" && !hasConfirmedReceipt && p.has("order.close_short")) actions.push("close_short");
  if ((LIVE_ORDER_STATUSES as readonly string[]).includes(o.status) && p.has("order.cancel") && !hasConfirmedReceipt) actions.push("cancel");
  return actions;
}
