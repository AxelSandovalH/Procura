import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import type { expenses } from "@prisma/client";
import { Problem } from "@/lib/http/problem";

/** Con ERP los gastos los lleva el ERP: Procura no los registra. */
export async function assertExpensesManagedHere(tx: Tx, organizationId: string) {
  const s = await tx.organization_settings.findUnique({ where: { organization_id: organizationId }, select: { expenses_managed_by: true } });
  if (s?.expenses_managed_by === "ERP") throw Problem.conflict("Los gastos de esta organización los lleva su ERP. Procura le entrega la orden recibida y la factura ligada.");
}

/** Facturas ligadas a un gasto y su suma, para comparar contra el monto del gasto. */
export async function expenseWithInvoices(tx: Tx, e: expenses) {
  const links = await tx.expense_invoices.findMany({ where: { expense_id: e.id }, select: { supplier_invoice_id: true } });
  const invoices = links.length ? await tx.supplier_invoices.findMany({ where: { id: { in: links.map((l) => l.supplier_invoice_id) } }, select: { id: true, fiscal_uuid: true, series: true, folio: true, issuer_name: true, total_minor: true, currency: true, status: true, order_id: true } }) : [];
  const sameCurrency = invoices.filter((i) => i.currency === e.currency);
  const invoicedMinor = sameCurrency.reduce((a, i) => a + i.total_minor, BigInt(0));
  return { ...e, invoices, invoices_total_minor: invoicedMinor, difference_minor: invoices.length ? e.amount_minor - invoicedMinor : null, mixed_currency: sameCurrency.length !== invoices.length };
}

export async function loadLinkableInvoices(tx: Tx, actor: Actor, ids: string[]) {
  if (ids.length === 0) return [];
  const invoices = await tx.supplier_invoices.findMany({ where: { id: { in: ids }, buyer_organization_id: actor.organizationId } });
  if (invoices.length !== new Set(ids).size) throw Problem.badRequest("Una o más facturas no existen o no son de tu organización");
  if (invoices.some((i) => i.status === "REJECTED")) throw Problem.badRequest("No se puede ligar una factura rechazada");
  return invoices;
}
