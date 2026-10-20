"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { money } from "@/lib/format";
import { Coverage, Donut, HBars, MonthlyBars } from "@/components/app/charts";

type Bucket = { count: number; total_minor: number | string };
interface Diff { kind: "sale" | "expense"; id: string; label: string; registered_minor: number | string; documented_minor: number | string; difference_minor: number | string }
interface Cur { sales_registered: Bucket; invoicing_issued: Bucket; invoices_received: Bucket; collections_received: Bucket; expenses_registered: Bucket; payments_made: Bucket; receivable: Bucket; payable: Bucket; sales_without_cfdi: Bucket; expenses_without_cfdi: Bucket; differences: Diff[] }
interface ChartData { months: { month: string; sales: number; expenses: number; collected: number; paid: number }[]; categories: { label: string; total_minor: number }[]; suppliers: { label: string; total_minor: number }[]; docs: { with: number; without: number }; with_list: DocRow[]; without_list: DocRow[] }
interface DocRow { id: string; description: string; supplier: string | null; spent_at: string; amount_minor: number; pdf_only: boolean }
interface Summary { period: { from: string; to: string }; by_currency: Record<string, Cur>; notice: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
function monthRange(offset: number) { const n = new Date(); return { from: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1))), to: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset + 1, 0))) }; }

function Stat({ title, hint, b, currency, tone }: { title: string; hint: string; b: Bucket; currency: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">{title}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" && Number(b.total_minor) > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{money(b.total_minor, currency)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{b.count} {b.count === 1 ? "registro" : "registros"} · {hint}</p></div>
  );
}

function DocList({ title, dot, rows, currency, empty }: { title: string; dot: string; rows: DocRow[]; currency: string; empty: string }) {
  return (
    <div><h4 className="mb-2 flex items-center gap-2 text-sm font-medium"><span className={`size-2.5 rounded-sm ${dot}`} />{title} <span className="font-normal text-muted-foreground">({rows.length})</span></h4>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border text-sm">{rows.map((r) => (
          <li key={r.id}><Link href="/gastos" className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-muted/50">
            <span className="min-w-0"><span className="block truncate">{r.description}</span><span className="block truncate text-xs text-muted-foreground">{r.supplier ?? "Sin proveedor"} · {r.spent_at}{r.pdf_only ? " · factura en PDF, falta XML" : ""}</span></span>
            <span className="shrink-0 tabular-nums">{money(r.amount_minor, currency)}</span></Link></li>))}</ul>)}
    </div>
  );
}

const Caption = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-xs leading-snug text-muted-foreground">{children}</p>;

/** Descripciones de cada gráfica con los datos reales del periodo (nada inventado: solo lo que muestran las barras y los sectores). */
function describe(c: ChartData, cur: string) {
  const last = c.months[c.months.length - 1], prev = c.months[c.months.length - 2];
  const m = (v: number) => money(v, cur);
  const name = (ym?: string) => (ym ? new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`)) : "");
  const registered = last ? `En ${name(last.month)}: ${m(last.sales)} vendidos y ${m(last.expenses)} gastados${prev ? `. En ${name(prev.month)}: ${m(prev.sales)} y ${m(prev.expenses)}` : ""}. Lo registrado cuenta aunque aún no se cobre o pague.` : "";
  const cash = last ? `En ${name(last.month)}: entraron ${m(last.collected)} por cobros y salieron ${m(last.paid)} por pagos${prev ? `; en ${name(prev.month)}, ${m(prev.collected)} y ${m(prev.paid)}` : ""}. Es dinero que ya se movió, no lo pendiente.` : "";
  const spent = c.docs.with + c.docs.without, topCat = c.categories[0], topSup = c.suppliers[0];
  const categories = topCat && spent > 0 ? `La categoría más grande es «${topCat.label}»: ${Math.round((topCat.total_minor / spent) * 100)}% de lo gastado en el periodo (${m(topCat.total_minor)}).` : "Sin gastos en el periodo elegido.";
  const suppliers = topSup && spent > 0 ? `${topSup.label} concentra ${Math.round((topSup.total_minor / spent) * 100)}% de lo gastado en el periodo (${m(topSup.total_minor)}). Se muestran los ${c.suppliers.length} proveedores con más gasto.` : "Sin gastos en el periodo elegido.";
  const coverage = spent > 0 ? `${Math.round((c.docs.with / spent) * 100)}% de lo gastado en el periodo ya tiene CFDI. ${c.without_list.length === 0 ? "No hay gastos sin factura." : `Los ${c.without_list.length} gastos sin CFDI suman ${m(c.docs.without)}: pídeles su factura o carga el XML; abajo está la lista.`}` : "Sin gastos en el periodo elegido.";
  return { registered, cash, categories, suppliers, coverage };
}

export default function FinanzasPage() {
  const session = useSession();
  const [range, setRange] = useState(monthRange(0));
  const q = useQuery({ queryKey: ["finance", range.from, range.to], queryFn: () => api<Summary>(`/finance/summary?from=${range.from}&to=${range.to}`), enabled: session.can("finance.read") });
  const charts = useQuery({ queryKey: ["finance", "charts", range.from, range.to], queryFn: () => api<{ by_currency: Record<string, ChartData> }>(`/finance/charts?from=${range.from}&to=${range.to}`), enabled: session.can("finance.read") });
  if (!session.can("finance.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver el resumen financiero.</p>;
  const currencies = Object.keys(q.data?.by_currency ?? {});
  return (
    <>
      <PageHeader title="Finanzas" description="Resumen operativo del periodo con los datos registrados en Procura." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted" onClick={() => setRange(monthRange(0))}>Este mes</button>
        <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted" onClick={() => setRange(monthRange(-1))}>Mes anterior</button>
        <Input aria-label="Desde" type="date" className="w-40" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input aria-label="Hasta" type="date" className="w-40" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {q.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-muted" /> : q.error ? <p className="text-sm text-destructive">No se pudo cargar el resumen (revisa que el periodo sea válido).</p> : currencies.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Sin movimientos en este periodo</p><p className="mt-1 text-sm text-muted-foreground">Registra ventas y gastos para ver el resumen.</p></div>
      ) : currencies.map((cur) => {
        const d = q.data!.by_currency[cur]!;
        return (
          <section key={cur} className="mb-8 space-y-3" aria-label={`Resumen en ${cur}`}>
            {currencies.length > 1 && <h2 className="text-lg font-semibold">{cur}</h2>}
            {charts.data?.by_currency[cur] && (() => { const c = charts.data!.by_currency[cur]!; const t = describe(c, cur); return (
              <div className="grid gap-3 lg:grid-cols-2">
                <Card className="gap-2 py-3"><CardHeader className="px-4"><CardTitle className="text-base">Registrado · últimos 6 meses</CardTitle></CardHeader><CardContent className="px-4"><MonthlyBars dense data={c.months} currency={cur} series={[{ key: "sales", label: "Ventas", color: "#10b981" }, { key: "expenses", label: "Gastos", color: "#f59e0b" }]} /><Caption>{t.registered}</Caption></CardContent></Card>
                <Card className="gap-2 py-3"><CardHeader className="px-4"><CardTitle className="text-base">Dinero que entró y salió</CardTitle></CardHeader><CardContent className="px-4"><MonthlyBars dense data={c.months} currency={cur} series={[{ key: "collected", label: "Cobros", color: "#6366f1" }, { key: "paid", label: "Pagos", color: "#ec4899" }]} /><Caption>{t.cash}</Caption></CardContent></Card>
                <Card className="gap-2 py-3"><CardHeader className="px-4"><CardTitle className="text-base">Gastos por categoría</CardTitle></CardHeader><CardContent className="px-4"><Donut dense items={c.categories} currency={cur} centerLabel="Total" /><Caption>{t.categories}</Caption></CardContent></Card>
                <Card className="gap-2 py-3"><CardHeader className="px-4"><CardTitle className="text-base">Principales proveedores</CardTitle></CardHeader><CardContent className="px-4"><HBars dense items={c.suppliers} currency={cur} /><Caption>{t.suppliers}</Caption></CardContent></Card>
                <Card className="lg:col-span-2"><CardHeader><CardTitle>Gasto documentado</CardTitle></CardHeader><CardContent><Coverage withDoc={c.docs.with} withoutDoc={c.docs.without} currency={cur} /><Caption>{t.coverage}</Caption>
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <DocList title="Con CFDI" dot="bg-emerald-500" rows={c.with_list} currency={cur} empty="Ningún gasto del periodo tiene CFDI ligado." />
                    <DocList title="Sin CFDI" dot="bg-amber-400" rows={c.without_list} currency={cur} empty="Todos los gastos del periodo tienen CFDI." />
                  </div></CardContent></Card>
              </div>); })()}
            <p role="note" className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" />No es utilidad fiscal, declaración de impuestos ni contabilidad definitiva. Ventas registradas, facturación emitida, cobros y gastos son conceptos distintos y no se suman entre sí.</p>
            <div><h3 className="mb-2 text-sm font-medium text-muted-foreground">Ingresos</h3><div className="grid gap-3 sm:grid-cols-3">
              <Stat title="Ventas registradas" hint="en el periodo" b={d.sales_registered} currency={cur} /><Stat title="Facturación emitida" hint="CFDI de ingreso vigentes" b={d.invoicing_issued} currency={cur} /><Stat title="Cobros recibidos" hint="en el periodo" b={d.collections_received} currency={cur} /></div></div>
            <div><h3 className="mb-2 text-sm font-medium text-muted-foreground">Egresos</h3><div className="grid gap-3 sm:grid-cols-3">
              <Stat title="Gastos registrados" hint="en el periodo" b={d.expenses_registered} currency={cur} /><Stat title="Facturas recibidas" hint="CFDI de ingreso vigentes" b={d.invoices_received} currency={cur} /><Stat title="Pagos realizados" hint="en el periodo" b={d.payments_made} currency={cur} /></div></div>
            <div><h3 className="mb-2 text-sm font-medium text-muted-foreground">Pendientes (al {q.data!.period.to})</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat title="Ventas por cobrar" hint="saldo vivo" b={d.receivable} currency={cur} tone="warn" /><Stat title="Gastos por pagar" hint="saldo vivo" b={d.payable} currency={cur} tone="warn" />
              <Stat title="Ventas sin CFDI" hint="del periodo" b={d.sales_without_cfdi} currency={cur} tone="warn" /><Stat title="Gastos sin CFDI" hint="del periodo" b={d.expenses_without_cfdi} currency={cur} tone="warn" /></div></div>
            <Card><CardHeader><CardTitle>Diferencias entre lo registrado y lo documentado</CardTitle></CardHeader><CardContent>
              {d.differences.length === 0 ? <p className="text-sm text-muted-foreground">Sin diferencias: lo que tiene CFDI coincide con su total.</p> : (
                <ul className="divide-y text-sm">{d.differences.map((x) => (
                  <li key={`${x.kind}-${x.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link className="font-medium underline-offset-2 hover:underline" href={x.kind === "sale" ? `/ventas/${x.id}` : "/gastos"}>{x.label}</Link>
                    <span className="text-muted-foreground">Registrado {money(x.registered_minor, cur)} · documentado {money(x.documented_minor, cur)}</span>
                    <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">{Number(x.difference_minor) > 0 ? "Faltan " : "Sobran "}{money(Math.abs(Number(x.difference_minor)), cur)}</span></li>))}</ul>)}
            </CardContent></Card>
          </section>);
      })}
    </>
  );
}
