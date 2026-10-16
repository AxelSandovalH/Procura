import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { assertFeature } from "@/lib/billing/entitlements";
import { computeMonthlyTaxes, type ExpensePaymentOut, type SalePaymentIn } from "@/lib/finance/taxes";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Estimación de impuestos del mes (RESICO persona física) con lo cobrado y pagado en el mes (base de flujo): ISR, IVA, retenciones y cómo influyen los gastos.
 * Solo estima; no presenta nada ante el SAT. Solo pesos mexicanos: lo registrado en otra moneda se avisa aparte.
 */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "finance.read");
  await assertFeature(actor.organizationId, "finance_reports");
  const m = new URL(req.url).searchParams.get("month") ?? iso(new Date()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw Problem.badRequest("El mes debe ser AAAA-MM");
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 1)); // fin exclusivo
  const org = actor.organizationId;
  const out = await withContext({ userId: actor.userId, organizationId: org }, async (tx) => {
    const orgRow = await tx.organizations.findUniqueOrThrow({ where: { id: org }, select: { tax_id: true, legal_name: true } });
    const pays = await tx.payments.findMany({ where: { organization_id: org, voided_at: null, paid_at: { gte: start, lt: end } } });
    const foreign = pays.filter((p) => p.currency !== "MXN").length;
    const inPays = pays.filter((p) => p.direction === "IN" && p.sale_id && p.currency === "MXN"), outPays = pays.filter((p) => p.direction === "OUT" && p.expense_id && p.currency === "MXN");
    const sales = new Map((await tx.sales.findMany({ where: { id: { in: inPays.map((p) => p.sale_id!) }, voided_at: null } })).map((s) => [s.id, s]));
    const exps = new Map((await tx.expenses.findMany({ where: { id: { in: outPays.map((p) => p.expense_id!) }, voided_at: null } })).map((e) => [e.id, e]));
    const links = await tx.cfdi_links.findMany({ where: { expense_id: { in: [...exps.keys()] } } });
    const docs = new Map((await tx.cfdi_documents.findMany({ where: { id: { in: links.map((l) => l.cfdi_id) }, direction: "RECEIVED", cfdi_type: "I", sat_status: { notIn: ["CANCELADO", "CANCELANDO"] } } })).map((d) => [d.id, d]));
    const ivaOf = new Map<string, number>(), withCfdi = new Set<string>();
    for (const l of links) { const d = docs.get(l.cfdi_id); if (!d || !l.expense_id || Number(d.total_minor) <= 0) continue; withCfdi.add(l.expense_id); ivaOf.set(l.expense_id, (ivaOf.get(l.expense_id) ?? 0) + Number(d.tax_minor) * (Number(l.amount_minor) / Number(d.total_minor))); }
    const salePays: SalePaymentIn[] = inPays.flatMap((p) => { const s = sales.get(p.sale_id!); return s ? [{ saleId: s.id, folio: s.folio, description: s.description, paidAt: iso(p.paid_at), amountMinor: Number(p.amount_minor), subtotalMinor: Number(s.subtotal_minor), discountMinor: Number(s.discount_minor), taxMinor: Number(s.tax_minor), totalMinor: Number(s.total_minor), withheldMinor: Number(s.withheld_minor) }] : []; });
    const expPays: ExpensePaymentOut[] = outPays.flatMap((p) => { const e = exps.get(p.expense_id!); return e ? [{ expenseId: e.id, description: e.description, supplier: e.supplier_name, paidAt: iso(p.paid_at), amountMinor: Number(p.amount_minor), expenseAmountMinor: Number(e.amount_minor), method: p.method, ivaMinor: ivaOf.get(e.id) ?? 0, hasCfdi: withCfdi.has(e.id), pdfOnly: !!e.cfdi_uuid_hint && !withCfdi.has(e.id) }] : []; });
    const uninvoiced = [...new Set(salePays.map((p) => p.saleId))].filter((id) => Number(sales.get(id)!.documented_minor) === 0);
    return { taxes: computeMonthlyTaxes(salePays, expPays), personaFisica: (orgRow.tax_id ?? "").trim().length === 13, taxId: orgRow.tax_id, foreign, uninvoiced: salePays.filter((p) => uninvoiced.includes(p.saleId)).reduce((a, p) => a + p.amountMinor, 0) };
  });
  const due = new Date(Date.UTC(y, mo, 17));
  return NextResponse.json({ month: m, due_date: iso(due), person_is_individual: out.personaFisica, tax_id: out.taxId, other_currency_payments: out.foreign, collected_without_invoice_minor: out.uninvoiced, ...out.taxes });
});
