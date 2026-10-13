import type { Tx } from "@/lib/db/client";
import { expenseStatuses, saleStatuses } from "@/lib/finance/views";
import { INVOICING_STATUS, PAYMENT_STATUS, SAT_STATUS } from "@/lib/ui/status";
import { day, pesos, type Cell } from "@/lib/export/csv";

export const EXPORT_TYPES = ["gastos", "ventas", "pagos", "cfdi_emitidos", "cfdi_recibidos", "banco"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const MAX_ROWS = 20_000;
export interface Dataset { filename: string; header: string[]; rows: Cell[][]; truncated: boolean }

const label = (m: Record<string, { label: string }>, k: string) => m[k]?.label ?? k;
const CFDI_TYPE: Record<string, string> = { I: "Ingreso", E: "Egreso", P: "Pago", T: "Traslado", N: "Nómina" };

/** Arma el conjunto de datos de una exportación (solo lectura, de la organización activa, por rango de fechas). */
export async function buildDataset(tx: Tx, org: string, type: ExportType, from: Date, to: Date): Promise<Dataset> {
  const name = (t: string) => `procura-${t}-${day(from)}_${day(to)}.csv`;
  const take = MAX_ROWS + 1;
  const trim = <T,>(rows: T[]) => ({ rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS });

  if (type === "gastos") {
    const r = await tx.expenses.findMany({ where: { organization_id: org, spent_at: { gte: from, lte: to } }, orderBy: [{ spent_at: "asc" }, { created_at: "asc" }], take });
    const t = trim(r);
    const links = await tx.cfdi_links.findMany({ where: { expense_id: { in: t.rows.map((e) => e.id) } }, select: { expense_id: true, cfdi_id: true } });
    const docs = new Map((await tx.cfdi_documents.findMany({ where: { id: { in: links.map((l) => l.cfdi_id) } }, select: { id: true, fiscal_uuid: true } })).map((d) => [d.id, d.fiscal_uuid]));
    const uuids = (id: string) => links.filter((l) => l.expense_id === id).map((l) => docs.get(l.cfdi_id)).filter(Boolean).join(" ");
    return { filename: name("gastos"), truncated: t.truncated,
      header: ["Fecha", "Descripción", "Proveedor", "Categoría", "Moneda", "Monto", "Pagado", "Pendiente de pago", "Estado de pago", "Estado de CFDI", "UUID de CFDI", "Referencia", "Origen", "Anulado"],
      rows: t.rows.map((e) => { const s = expenseStatuses(e); return [day(e.spent_at), e.description, e.supplier_name, e.category, e.currency, pesos(e.amount_minor), pesos(e.paid_minor), e.voided_at ? 0 : pesos(e.amount_minor - e.paid_minor), label(PAYMENT_STATUS, s.payment_status), label(INVOICING_STATUS, s.invoicing_status), uuids(e.id), e.external_reference, e.source, !!e.voided_at]; }) };
  }
  if (type === "ventas") {
    const r = await tx.sales.findMany({ where: { organization_id: org, sold_at: { gte: from, lte: to } }, orderBy: [{ sold_at: "asc" }, { folio: "asc" }], take });
    const t = trim(r);
    const cust = new Map((await tx.customers.findMany({ where: { id: { in: t.rows.map((s) => s.customer_id).filter((x): x is string => !!x) } }, select: { id: true, name: true, tax_id: true } })).map((c) => [c.id, c]));
    const links = await tx.cfdi_links.findMany({ where: { sale_id: { in: t.rows.map((s) => s.id) } }, select: { sale_id: true, cfdi_id: true } });
    const docs = new Map((await tx.cfdi_documents.findMany({ where: { id: { in: links.map((l) => l.cfdi_id) } }, select: { id: true, fiscal_uuid: true } })).map((d) => [d.id, d.fiscal_uuid]));
    return { filename: name("ventas"), truncated: t.truncated,
      header: ["Folio", "Fecha", "Cliente", "RFC del cliente", "Descripción", "Moneda", "Subtotal", "Descuento", "IVA", "Total", "Retenido por el cliente", "Cobrado", "Por cobrar", "Estado de cobro", "Estado de facturación", "UUID de CFDI", "Anulada"],
      rows: t.rows.map((s) => { const st = saleStatuses(s); const c = s.customer_id ? cust.get(s.customer_id) : undefined; return [s.folio, day(s.sold_at), c?.name, c?.tax_id, s.description, s.currency, pesos(s.subtotal_minor), pesos(s.discount_minor), pesos(s.tax_minor), pesos(s.total_minor), pesos(s.withheld_minor), pesos(s.collected_minor), s.voided_at ? 0 : pesos(s.total_minor - s.withheld_minor - s.collected_minor), label({ PENDING: { label: "Pendiente de cobro" }, PARTIAL: { label: "Cobro parcial" }, COLLECTED: { label: "Cobrada" }, VOIDED: { label: "Anulada" } }, st.collection_status), label(INVOICING_STATUS, st.invoicing_status), links.filter((l) => l.sale_id === s.id).map((l) => docs.get(l.cfdi_id)).filter(Boolean).join(" "), !!s.voided_at]; }) };
  }
  if (type === "pagos") {
    const r = await tx.payments.findMany({ where: { organization_id: org, paid_at: { gte: from, lte: to } }, orderBy: [{ paid_at: "asc" }, { created_at: "asc" }], take });
    const t = trim(r);
    const ex = new Map((await tx.expenses.findMany({ where: { id: { in: t.rows.map((p) => p.expense_id).filter((x): x is string => !!x) } }, select: { id: true, description: true } })).map((e) => [e.id, e.description]));
    const sa = new Map((await tx.sales.findMany({ where: { id: { in: t.rows.map((p) => p.sale_id).filter((x): x is string => !!x) } }, select: { id: true, folio: true } })).map((s) => [s.id, s.folio]));
    return { filename: name("pagos-y-cobros"), truncated: t.truncated,
      header: ["Fecha", "Tipo", "Operación", "Moneda", "Monto", "Método", "Referencia", "Notas", "Anulado"],
      rows: t.rows.map((p) => [day(p.paid_at), p.direction === "IN" ? "Cobro de venta" : "Pago de gasto", p.sale_id ? sa.get(p.sale_id) : p.expense_id ? ex.get(p.expense_id) : "", p.currency, pesos(p.amount_minor), p.method, p.external_reference, p.notes, !!p.voided_at]) };
  }
  if (type === "cfdi_emitidos" || type === "cfdi_recibidos") {
    const dir = type === "cfdi_emitidos" ? "ISSUED" : "RECEIVED";
    const r = await tx.cfdi_documents.findMany({ where: { organization_id: org, direction: dir, issued_at: { gte: from, lt: new Date(to.getTime() + 86_400_000) } }, orderBy: [{ issued_at: "asc" }], take });
    const t = trim(r);
    return { filename: name(type === "cfdi_emitidos" ? "cfdi-emitidos" : "cfdi-recibidos"), truncated: t.truncated,
      header: ["Fecha de emisión", "Serie", "Folio", "UUID", "Tipo", "Emisor", "RFC del emisor", "Receptor", "RFC del receptor", "Moneda", "Subtotal", "Descuento", "IVA trasladado", "Impuestos retenidos", "Total", "Forma de pago", "Método de pago", "Estado ante el SAT", "Importe ligado a operaciones", "Origen"],
      rows: t.rows.map((d) => [day(d.issued_at), d.series, d.folio, d.fiscal_uuid, CFDI_TYPE[d.cfdi_type] ?? d.cfdi_type, d.issuer_name, d.issuer_rfc, d.receiver_name, d.receiver_rfc, d.currency, pesos(d.subtotal_minor), pesos(d.discount_minor), pesos(d.tax_minor), pesos(d.retained_minor), pesos(d.total_minor), d.fiscal_payment_form, d.fiscal_payment_method, label(SAT_STATUS, d.sat_status), pesos(d.allocated_minor), d.source]) };
  }
  // banco
  const r = await tx.bank_transactions.findMany({ where: { organization_id: org, posted_at: { gte: from, lte: to } }, orderBy: [{ posted_at: "asc" }, { created_at: "asc" }], take });
  const t = trim(r);
  const acc = new Map((await tx.bank_accounts.findMany({ where: { organization_id: org }, select: { id: true, name: true, last4: true } })).map((a) => [a.id, `${a.name}${a.last4 ? ` ·${a.last4}` : ""}`]));
  return { filename: name("movimientos-bancarios"), truncated: t.truncated,
    header: ["Fecha", "Cuenta", "Descripción", "Cargo", "Abono", "Saldo", "Referencia", "Estado de conciliación"],
    rows: t.rows.map((x) => [day(x.posted_at), acc.get(x.bank_account_id), x.description, x.amount_minor < BigInt(0) ? pesos(-x.amount_minor) : null, x.amount_minor > BigInt(0) ? pesos(x.amount_minor) : null, pesos(x.balance_minor), x.reference, x.status === "MATCHED" ? "Conciliado" : x.status === "IGNORED" ? "Ignorado" : "Por conciliar"]) };
}
