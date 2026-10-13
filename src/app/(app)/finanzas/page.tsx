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

type Bucket = { count: number; total_minor: number | string };
interface Diff { kind: "sale" | "expense"; id: string; label: string; registered_minor: number | string; documented_minor: number | string; difference_minor: number | string }
interface Cur { sales_registered: Bucket; invoicing_issued: Bucket; invoices_received: Bucket; collections_received: Bucket; expenses_registered: Bucket; payments_made: Bucket; receivable: Bucket; payable: Bucket; sales_without_cfdi: Bucket; expenses_without_cfdi: Bucket; differences: Diff[] }
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

export default function FinanzasPage() {
  const session = useSession();
  const [range, setRange] = useState(monthRange(0));
  const q = useQuery({ queryKey: ["finance", range.from, range.to], queryFn: () => api<Summary>(`/finance/summary?from=${range.from}&to=${range.to}`), enabled: session.can("finance.read") });
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
      <p role="note" className="mb-6 flex items-start gap-2 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" />No es utilidad fiscal, declaración de impuestos ni contabilidad definitiva. Ventas registradas, facturación emitida, cobros y gastos son conceptos distintos y no se suman entre sí.</p>
      {q.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-muted" /> : q.error ? <p className="text-sm text-destructive">No se pudo cargar el resumen (revisa que el periodo sea válido).</p> : currencies.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Sin movimientos en este periodo</p><p className="mt-1 text-sm text-muted-foreground">Registra ventas y gastos para ver el resumen.</p></div>
      ) : currencies.map((cur) => {
        const d = q.data!.by_currency[cur]!;
        return (
          <section key={cur} className="mb-8 space-y-4" aria-label={`Resumen en ${cur}`}>
            <h2 className="text-lg font-semibold">{cur}</h2>
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
