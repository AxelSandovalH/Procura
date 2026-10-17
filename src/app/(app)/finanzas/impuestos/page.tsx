"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";

interface Taxes {
  month: string; due_date: string; person_is_individual: boolean; tax_id: string | null; other_currency_payments: number; collected_without_invoice_minor: number;
  income: { baseMinor: number; lines: { saleId: string; folio: string; description: string; paidAt: string; firstPaidAt: string; payments: number; baseMinor: number; ivaMinor: number; isrWithheldMinor: number; ivaWithheldMinor: number }[] };
  isr: { rate: number; causedMinor: number; withheldMinor: number; payableMinor: number; creditMinor: number; next: { atMinor: number; rate: number; remainingMinor: number } | null };
  iva: { collectedMinor: number; creditableMinor: number; withheldMinor: number; payableMinor: number; favorMinor: number };
  totalPayableMinor: number;
  expenses: { creditableMinor: number; lostCashMinor: number; withoutXmlMinor: number; lines: { expenseId: string; description: string; supplier: string | null; paidAt: string; amountMinor: number; ivaCreditMinor: number; reason: string; note: string }[] };
}
const REASON: Record<string, string> = { ACREDITABLE: "Acredita IVA", SIN_XML: "Sin XML", EFECTIVO: "Efectivo > $2,000", SIN_IVA: "Sin IVA" };
const Row = ({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) => (
  <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "border-t pt-2 font-semibold" : ""}`}><dt className="text-muted-foreground">{label}{hint && <span className="block text-xs">{hint}</span>}</dt><dd className="tabular-nums">{value}</dd></div>
);

/** Estimación de impuestos del mes para un RESICO persona física: ISR, IVA, retenciones y cómo influyen los gastos. Solo estima; la declaración la presenta tu contador. */
export default function Impuestos() {
  const session = useSession();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ["taxes", month], queryFn: () => api<Taxes>(`/finance/taxes?month=${month}`), enabled: session.can("finance.read") && /^\d{4}-\d{2}$/.test(month) });
  if (!session.can("finance.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver información financiera.</p>;
  const t = q.data; const c = "MXN";
  return (
    <>
      <PageHeader title="Impuestos del mes" description="Cuánto vas a pagar de ISR e IVA con lo que cobraste y pagaste en el mes, y cómo influyen tus gastos. Es una estimación para planear: tu contador presenta la declaración." />
      <div className="mb-5 flex items-end gap-3"><div className="space-y-1.5"><Label htmlFor="tx-m">Mes</Label><Input id="tx-m" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} /></div></div>
      {q.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      {q.isError && <p role="alert" className="text-sm text-destructive">No se pudo calcular. Esta sección requiere el plan Control o superior.</p>}
      {t && (<div className="space-y-5">
        {!t.person_is_individual && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />Este cálculo es para persona física en RESICO (RFC de 13 caracteres). Tu RFC {t.tax_id ?? "no está capturado"}: para otro régimen no lo tomes como válido.</p>}
        <Card><CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
          <div><p className="text-sm text-muted-foreground">Total estimado a pagar</p><p className="text-3xl font-semibold tabular-nums">{money(t.totalPayableMinor, c)}</p><p className="text-xs text-muted-foreground">A más tardar el {dateShort(t.due_date)}</p></div>
          <div><p className="text-sm text-muted-foreground">ISR</p><p className="text-xl font-semibold tabular-nums">{money(t.isr.payableMinor, c)}</p></div>
          <div><p className="text-sm text-muted-foreground">IVA</p><p className="text-xl font-semibold tabular-nums">{t.iva.favorMinor > 0 ? `a favor ${money(t.iva.favorMinor, c)}` : money(t.iva.payableMinor, c)}</p></div>
        </CardContent></Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">ISR (RESICO)</CardTitle></CardHeader><CardContent><dl className="text-sm">
            <Row label="Ingresos cobrados del mes (sin IVA)" value={money(t.income.baseMinor, c)} />
            <Row label={`Tasa del tramo`} value={`${(t.isr.rate * 100).toFixed(2)} %`} hint="Se aplica a todo el ingreso del mes" />
            <Row label="ISR causado" value={money(t.isr.causedMinor, c)} />
            <Row label="− ISR que te retuvieron" value={money(t.isr.withheldMinor, c)} hint="1.25 % de clientes personas morales" />
            <Row label="ISR a pagar" value={money(t.isr.payableMinor, c)} strong />
            {t.isr.creditMinor > 0 && <p className="mt-1 text-xs text-muted-foreground">Te retuvieron {money(t.isr.creditMinor, c)} más de lo que causaste: queda a tu favor.</p>}
          </dl>
          {t.isr.next && <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs">Te faltan <b>{money(t.isr.next.remainingMinor, c)}</b> de ingresos para pasar al tramo de {(t.isr.next.rate * 100).toFixed(1)} %, que se aplicaría a <b>todo</b> el mes.</p>}
          <p className="mt-3 text-xs text-muted-foreground">En RESICO los gastos <b>no</b> se deducen para el ISR: solo ayudan en el IVA.</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">IVA</CardTitle></CardHeader><CardContent><dl className="text-sm">
            <Row label="IVA cobrado a tus clientes" value={money(t.iva.collectedMinor, c)} />
            <Row label="− IVA acreditable de tus gastos" value={money(t.iva.creditableMinor, c)} hint="Con CFDI y pagados en el mes" />
            <Row label="− IVA que te retuvieron" value={money(t.iva.withheldMinor, c)} hint="10.6667 % de clientes personas morales" />
            <Row label={t.iva.favorMinor > 0 ? "IVA a favor" : "IVA a pagar"} value={money(t.iva.favorMinor > 0 ? t.iva.favorMinor : t.iva.payableMinor, c)} strong />
          </dl></CardContent></Card>
        </div>
        {(t.expenses.withoutXmlMinor > 0 || t.expenses.lostCashMinor > 0) && (
          <Card><CardContent className="space-y-1 pt-5 text-sm">
            {t.expenses.withoutXmlMinor > 0 && <p><b>{money(t.expenses.withoutXmlMinor, c)}</b> de gastos pagados este mes no tienen XML. Si los consigues, podrías acreditar hasta unos <b>{money(Math.round(t.expenses.withoutXmlMinor * 16 / 116), c)}</b> de IVA (si traen IVA al 16 %).</p>}
            {t.expenses.lostCashMinor > 0 && <p>Pagaste en efectivo gastos de más de $2,000 y por eso no se acreditan <b>{money(t.expenses.lostCashMinor, c)}</b> de IVA.</p>}
          </CardContent></Card>)}
        {t.collected_without_invoice_minor > 0 && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">Cobraste {money(t.collected_without_invoice_minor, c)} en ventas que aún no tienen factura ligada. También cuentan para tus impuestos.</p>}
        {t.other_currency_payments > 0 && <p className="text-xs text-muted-foreground">{t.other_currency_payments} pago{t.other_currency_payments === 1 ? "" : "s"} en otra moneda no se incluyeron en este cálculo (solo pesos).</p>}
        <Card><CardHeader><CardTitle className="text-base">Ingresos cobrados</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Fecha</th><th className="pr-3">Venta</th><th className="pr-3 text-right">Base</th><th className="pr-3 text-right">IVA</th><th className="pr-3 text-right">Ret. ISR</th><th className="text-right">Ret. IVA</th></tr></thead><tbody>
          {t.income.lines.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No cobraste ventas este mes.</td></tr>}
          {t.income.lines.map((l, i) => <tr key={i} className="border-t"><td className="py-1.5 pr-3">{l.payments > 1 && l.firstPaidAt !== l.paidAt ? `${dateShort(l.firstPaidAt)} – ${dateShort(l.paidAt)}` : dateShort(l.paidAt)}</td><td className="max-w-[18rem] truncate pr-3" title={l.description}>{l.folio} · {l.description}{l.payments > 1 ? ` (${l.payments} cobros)` : ""}</td><td className="pr-3 text-right tabular-nums">{money(l.baseMinor, c)}</td><td className="pr-3 text-right tabular-nums">{money(l.ivaMinor, c)}</td><td className="pr-3 text-right tabular-nums">{money(l.isrWithheldMinor, c)}</td><td className="text-right tabular-nums">{money(l.ivaWithheldMinor, c)}</td></tr>)}
        </tbody></table></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Gastos pagados este mes y su IVA</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Pago</th><th className="pr-3">Gasto</th><th className="pr-3 text-right">Pagado</th><th className="pr-3 text-right">IVA acreditable</th><th>Estado</th></tr></thead><tbody>
          {t.expenses.lines.length === 0 && <tr><td colSpan={5} className="py-3 text-muted-foreground">No pagaste gastos este mes.</td></tr>}
          {t.expenses.lines.map((l, i) => <tr key={i} className="border-t"><td className="py-1.5 pr-3">{dateShort(l.paidAt)}</td><td className="max-w-[18rem] truncate pr-3" title={`${l.description}${l.supplier ? ` · ${l.supplier}` : ""}`}>{l.description}</td><td className="pr-3 text-right tabular-nums">{money(l.amountMinor, c)}</td><td className="pr-3 text-right tabular-nums">{money(l.ivaCreditMinor, c)}</td><td title={l.note}>{REASON[l.reason] ?? l.reason}</td></tr>)}
        </tbody></table></CardContent></Card>
        <p className="text-xs text-muted-foreground">Estimación con lo cobrado y pagado en el mes (base de flujo). No considera saldos a favor de meses anteriores, gastos no deducibles, ni casos particulares. Confírmala con tu contador antes de pagar.</p>
      </div>)}
    </>
  );
}
