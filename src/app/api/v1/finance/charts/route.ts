import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Datos de las gráficas de Finanzas, por moneda: tendencia de 6 meses (ventas y gastos registrados, cobros y pagos), gastos por categoría,
 * principales proveedores y cuánto de lo gastado ya está documentado con CFDI. Mismos conceptos que el resumen: no se suman entre sí.
 */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "finance.read");
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const end = sp.get("to") && !isNaN(+new Date(sp.get("to")!)) ? new Date(sp.get("to")!) : now;
  const from = sp.get("from") && !isNaN(+new Date(sp.get("from")!)) ? new Date(sp.get("from")!) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
  const months = Array.from({ length: 6 }, (_, i) => ym(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5 + i, 1))));
  const org = actor.organizationId;
  type DocRow = { id: string; description: string; supplier: string | null; spent_at: string; amount_minor: number; pdf_only: boolean };
  const out = await withContext({ userId: actor.userId, organizationId: org }, async (tx) => {
    const [sales, exps, pays] = await Promise.all([
      tx.sales.findMany({ where: { organization_id: org, voided_at: null, sold_at: { gte: start, lte: end } }, select: { currency: true, sold_at: true, total_minor: true } }),
      tx.expenses.findMany({ where: { organization_id: org, voided_at: null, spent_at: { gte: start, lte: end } }, select: { id: true, description: true, cfdi_uuid_hint: true, currency: true, spent_at: true, amount_minor: true, category: true, supplier_name: true, documented_minor: true } }),
      tx.payments.findMany({ where: { organization_id: org, voided_at: null, paid_at: { gte: start, lte: end } }, select: { currency: true, direction: true, paid_at: true, amount_minor: true } }),
    ]);
    const cur: Record<string, { months: { month: string; sales: number; expenses: number; collected: number; paid: number }[]; categories: Map<string, number>; suppliers: Map<string, number>; docs: { with: number; without: number }; with_list: DocRow[]; without_list: DocRow[] }> = {};
    const slot = (c: string) => (cur[c] ??= { months: months.map((month) => ({ month, sales: 0, expenses: 0, collected: 0, paid: 0 })), categories: new Map(), suppliers: new Map(), docs: { with: 0, without: 0 }, with_list: [], without_list: [] });
    const mrow = (c: string, d: Date) => slot(c).months.find((m) => m.month === ym(d));
    for (const s of sales) { const m = mrow(s.currency, s.sold_at); if (m) m.sales += Number(s.total_minor); }
    for (const p of pays) { const m = mrow(p.currency, p.paid_at); if (m) m[p.direction === "IN" ? "collected" : "paid"] += Number(p.amount_minor); }
    for (const e of exps) {
      const s = slot(e.currency); const m = mrow(e.currency, e.spent_at); const amt = Number(e.amount_minor); if (m) m.expenses += amt;
      if (e.spent_at >= from) {
        const cat = e.category ?? "Sin categoría", sup = e.supplier_name ?? "Sin proveedor";
        s.categories.set(cat, (s.categories.get(cat) ?? 0) + amt); s.suppliers.set(sup, (s.suppliers.get(sup) ?? 0) + amt);
        const row: DocRow = { id: e.id, description: e.description, supplier: e.supplier_name, spent_at: e.spent_at.toISOString().slice(0, 10), amount_minor: amt, pdf_only: e.documented_minor === BigInt(0) && !!e.cfdi_uuid_hint };
        if (e.documented_minor > BigInt(0)) { s.docs.with += amt; s.with_list.push(row); } else { s.docs.without += amt; s.without_list.push(row); }
      }
    }
    const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, total_minor]) => ({ label, total_minor }));
    return Object.fromEntries(Object.entries(cur).map(([c, v]) => [c, { months: v.months, categories: top(v.categories, 6), suppliers: top(v.suppliers, 6), docs: v.docs, with_list: v.with_list.sort((a, b) => b.spent_at.localeCompare(a.spent_at)), without_list: v.without_list.sort((a, b) => b.amount_minor - a.amount_minor) }]));
  });
  return NextResponse.json({ period: { from: from.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }, by_currency: out });
});
