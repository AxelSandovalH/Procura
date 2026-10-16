import type { Tx } from "@/lib/db/client";
import type { cfdi_documents, expenses, sales } from "@prisma/client";
import { collectionStatus, documentation, invoicingStatus } from "@/lib/finance/calc";

/** Datos del CFDI que se muestran en una operación (nunca la clave de Storage). */
const cfdiBrief = (d: cfdi_documents) => ({ id: d.id, direction: d.direction, fiscal_uuid: d.fiscal_uuid, series: d.series, folio: d.folio, issued_at: d.issued_at, issuer_name: d.issuer_name, issuer_rfc: d.issuer_rfc, receiver_rfc: d.receiver_rfc, currency: d.currency, total_minor: d.total_minor, retained_minor: d.retained_minor, sat_status: d.sat_status, cfdi_type: d.cfdi_type });

async function linksOf(tx: Tx, where: { sale_id: string } | { expense_id: string }) {
  const links = await tx.cfdi_links.findMany({ where, orderBy: { created_at: "asc" } });
  const docs = links.length ? await tx.cfdi_documents.findMany({ where: { id: { in: links.map((l) => l.cfdi_id) } } }) : [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  return links.map((l) => ({ id: l.id, amount_minor: l.amount_minor, created_at: l.created_at, cfdi: cfdiBrief(byId.get(l.cfdi_id)!) }));
}
const paymentsOf = (tx: Tx, where: { sale_id: string } | { expense_id: string }) => tx.payments.findMany({ where, orderBy: [{ paid_at: "asc" }, { created_at: "asc" }] });

export function saleStatuses(s: sales) {
  return {
    collection_status: collectionStatus({ total_minor: s.total_minor - s.withheld_minor, settled_minor: s.collected_minor, voided_at: s.voided_at }),
    invoicing_status: invoicingStatus({ total_minor: s.total_minor, documented_minor: s.documented_minor, invoicing_flag: s.invoicing_flag }),
    pending_to_collect_minor: s.voided_at ? BigInt(0) : s.total_minor - s.withheld_minor - s.collected_minor,
    ...documentation(s.total_minor, s.documented_minor),
  };
}
export function expenseStatuses(e: expenses) {
  return {
    payment_status: collectionStatus({ total_minor: e.amount_minor, settled_minor: e.paid_minor, voided_at: e.voided_at }),
    invoicing_status: invoicingStatus({ total_minor: e.amount_minor, documented_minor: e.documented_minor }),
    pending_to_pay_minor: e.voided_at ? BigInt(0) : e.amount_minor - e.paid_minor,
    ...documentation(e.amount_minor, e.documented_minor),
  };
}

export async function saleView(tx: Tx, s: sales) {
  const [lines, payments, cfdi, customer, fiscalIssue] = await Promise.all([
    tx.sale_lines.findMany({ where: { sale_id: s.id }, orderBy: { line_number: "asc" } }),
    paymentsOf(tx, { sale_id: s.id }), linksOf(tx, { sale_id: s.id }),
    s.customer_id ? tx.customers.findFirst({ where: { id: s.customer_id }, select: { id: true, name: true, tax_id: true, tax_regime_code: true, zip_code: true, cfdi_use_code: true, email: true } }) : null,
    tx.fiscal_issue_requests.findFirst({ where: { sale_id: s.id }, orderBy: { created_at: "desc" }, select: { status: true, error: true, provider_invoice_id: true, created_at: true } }),
  ]);
  return { ...s, ...saleStatuses(s), customer, lines, payments, cfdi, fiscal_issue: fiscalIssue };
}
export async function expenseCfdi(tx: Tx, e: expenses) {
  return { ...expenseStatuses(e), payments: await paymentsOf(tx, { expense_id: e.id }), cfdi: await linksOf(tx, { expense_id: e.id }) };
}
