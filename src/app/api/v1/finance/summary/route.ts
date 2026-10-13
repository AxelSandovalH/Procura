import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

const zero = () => BigInt(0);
type Bucket = { count: number; total_minor: bigint };
const empty = (): Bucket => ({ count: 0, total_minor: zero() });

/**
 * Resumen financiero del periodo, por moneda (nunca se suman monedas distintas). Todo sale de datos persistidos:
 * ventas registradas, facturación emitida, cobros, gastos, pagos, pendientes y diferencias son conceptos DISTINTOS y no se
 * suman entre sí. No es utilidad fiscal, declaración de impuestos ni contabilidad definitiva.
 */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "finance.read");
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const from = sp.get("from") ? new Date(sp.get("from")!) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = sp.get("to") ? new Date(sp.get("to")!) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  if (isNaN(+from) || isNaN(+to) || from > to) throw Problem.badRequest("Periodo inválido (from/to en formato YYYY-MM-DD, from ≤ to)");
  const toEnd = new Date(`${to.toISOString().slice(0, 10)}T23:59:59.999Z`);
  const org = actor.organizationId;

  const data = await withContext({ userId: actor.userId, organizationId: org }, async (tx) => {
    const byCur: Record<string, Record<string, unknown>> = {};
    const slot = (cur: string) => (byCur[cur] ??= {
      sales_registered: empty(), invoicing_issued: empty(), invoices_received: empty(), collections_received: empty(), expenses_registered: empty(), payments_made: empty(),
      receivable: empty(), payable: empty(), sales_without_cfdi: empty(), expenses_without_cfdi: empty(), differences: [] as unknown[],
    });
    const put = (cur: string, key: string, b: Bucket) => { (slot(cur)[key] as Bucket) = b; };

    for (const r of await tx.sales.groupBy({ by: ["currency"], where: { organization_id: org, voided_at: null, sold_at: { gte: from, lte: to } }, _count: true, _sum: { total_minor: true } })) put(r.currency, "sales_registered", { count: r._count, total_minor: r._sum.total_minor ?? zero() });
    for (const r of await tx.cfdi_documents.groupBy({ by: ["currency"], where: { organization_id: org, direction: "ISSUED", cfdi_type: "I", sat_status: { not: "CANCELADO" }, issued_at: { gte: from, lte: toEnd } }, _count: true, _sum: { total_minor: true } })) put(r.currency, "invoicing_issued", { count: r._count, total_minor: r._sum.total_minor ?? zero() });
    for (const r of await tx.cfdi_documents.groupBy({ by: ["currency"], where: { organization_id: org, direction: "RECEIVED", cfdi_type: "I", sat_status: { not: "CANCELADO" }, issued_at: { gte: from, lte: toEnd } }, _count: true, _sum: { total_minor: true } })) put(r.currency, "invoices_received", { count: r._count, total_minor: r._sum.total_minor ?? zero() });
    for (const r of await tx.payments.groupBy({ by: ["currency"], where: { organization_id: org, direction: "IN", voided_at: null, paid_at: { gte: from, lte: to } }, _count: true, _sum: { amount_minor: true } })) put(r.currency, "collections_received", { count: r._count, total_minor: r._sum.amount_minor ?? zero() });
    for (const r of await tx.expenses.groupBy({ by: ["currency"], where: { organization_id: org, voided_at: null, spent_at: { gte: from, lte: to } }, _count: true, _sum: { amount_minor: true } })) put(r.currency, "expenses_registered", { count: r._count, total_minor: r._sum.amount_minor ?? zero() });
    for (const r of await tx.payments.groupBy({ by: ["currency"], where: { organization_id: org, direction: "OUT", voided_at: null, paid_at: { gte: from, lte: to } }, _count: true, _sum: { amount_minor: true } })) put(r.currency, "payments_made", { count: r._count, total_minor: r._sum.amount_minor ?? zero() });

    // Pendientes: saldo vivo a la fecha final del periodo (no solo lo registrado en el periodo).
    const openSales = await tx.sales.findMany({ where: { organization_id: org, voided_at: null, sold_at: { lte: to } }, select: { currency: true, total_minor: true, withheld_minor: true, collected_minor: true } });
    for (const s of openSales) if (s.total_minor - s.withheld_minor > s.collected_minor) { const b = slot(s.currency).receivable as Bucket; b.count++; b.total_minor += s.total_minor - s.withheld_minor - s.collected_minor; }
    const openExp = await tx.expenses.findMany({ where: { organization_id: org, voided_at: null, spent_at: { lte: to } }, select: { currency: true, amount_minor: true, paid_minor: true } });
    for (const e of openExp) if (e.amount_minor > e.paid_minor) { const b = slot(e.currency).payable as Bucket; b.count++; b.total_minor += e.amount_minor - e.paid_minor; }

    // Operaciones del periodo sin CFDI y diferencias entre lo registrado y lo documentado.
    const sales = await tx.sales.findMany({ where: { organization_id: org, voided_at: null, sold_at: { gte: from, lte: to } }, select: { id: true, folio: true, currency: true, total_minor: true, documented_minor: true } });
    const exps = await tx.expenses.findMany({ where: { organization_id: org, voided_at: null, spent_at: { gte: from, lte: to } }, select: { id: true, description: true, currency: true, amount_minor: true, documented_minor: true } });
    for (const s of sales) {
      if (s.documented_minor === zero()) { const b = slot(s.currency).sales_without_cfdi as Bucket; b.count++; b.total_minor += s.total_minor; }
      else if (s.documented_minor !== s.total_minor) (slot(s.currency).differences as unknown[]).push({ kind: "sale", id: s.id, label: s.folio, registered_minor: s.total_minor, documented_minor: s.documented_minor, difference_minor: s.total_minor - s.documented_minor });
    }
    for (const e of exps) {
      if (e.documented_minor === zero()) { const b = slot(e.currency).expenses_without_cfdi as Bucket; b.count++; b.total_minor += e.amount_minor; }
      else if (e.documented_minor !== e.amount_minor) (slot(e.currency).differences as unknown[]).push({ kind: "expense", id: e.id, label: e.description, registered_minor: e.amount_minor, documented_minor: e.documented_minor, difference_minor: e.amount_minor - e.documented_minor });
    }
    return byCur;
  });
  return NextResponse.json({ period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, by_currency: data,
    notice: "Resumen operativo con los datos registrados en Procura. No es utilidad fiscal, declaración de impuestos ni contabilidad definitiva." });
});
