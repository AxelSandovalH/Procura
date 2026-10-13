import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COMPARISON, CURRENCY, FINANCE_PLANS, NEGOCIO_BENEFITS, SAT_RECOVERY, SERVICE_FEE, STAMP_PACKS, chargeBreakdown, planIncludes, type FinancePlan } from "@/lib/commercial/plans";

const cents = new Intl.NumberFormat("es-MX", { style: "currency", currency: CURRENCY, minimumFractionDigits: 2 });
const whole = new Intl.NumberFormat("es-MX", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
const m = (minor: number) => cents.format(minor / 100);

const SHORT: Record<string, string[]> = {
  esencial: ["Ingresos, gastos y comprobantes de cada gasto", "Notas con fecha y autor", "Listados con estado de pago, cobro y factura"],
  control: ["Todo lo de Esencial", "Compras: requisiciones, cotizaciones y órdenes", "Facturas ligadas a tus gastos y ventas", "Reportes y exportaciones para tu contador"],
  empresa: ["Todo lo de Negocio", "API y webhooks para tu ERP o punto de venta", "Acompañamiento e integraciones a la medida, cotizados aparte"],
};

function SmallPlan({ plan }: { plan: FinancePlan }) {
  return (
    <article aria-labelledby={`sp-${plan.id}`} className="flex flex-col rounded-2xl border bg-card p-6">
      <h3 id={`sp-${plan.id}`} className="font-semibold tracking-tight">{plan.name}</h3>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
        {plan.priceFrom && <span className="text-sm text-muted-foreground">Desde</span>}
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{whole.format(plan.price)}</span>
        <span className="text-sm text-muted-foreground">{CURRENCY} / mes + IVA</span>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{plan.tagline}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm">{SHORT[plan.id]!.map((x) => <li key={x} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{x}</li>)}</ul>
      <Link href="/registro" className={cn(buttonVariants({ variant: "outline" }), "mt-5 w-full justify-center")}>Crear cuenta<span className="sr-only"> para el plan {plan.name}</span></Link>
    </article>
  );
}

/** Precios y costos adicionales. Los datos salen de `lib/commercial/plans.ts` (y el cobro de `chargeBreakdown`, el mismo cálculo que usa el pago): no hay cifras escritas a mano. */
export function FinancePricing() {
  const negocio = FINANCE_PLANS.find((p) => p.id === "negocio")!, control = FINANCE_PLANS.find((p) => p.id === "control")!;
  const others = FINANCE_PLANS.filter((p) => p.id !== "negocio");
  const br = chargeBreakdown(negocio.price * 100);
  return (
    <>
      <section id="precios" aria-labelledby="precios-titulo" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="precios-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Un plan para tener tus finanzas en orden.</h2>
          <p className="mt-4 text-lg text-muted-foreground">Negocio reúne lo necesario para controlar tus gastos, tus facturas y tus movimientos bancarios.</p>
        </div>

        <article aria-labelledby="plan-negocio" className="mt-12 grid gap-8 rounded-3xl border border-foreground/70 bg-card p-6 shadow-sm ring-1 ring-foreground/10 sm:p-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col">
            <p className="w-fit rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Recomendado para ordenar tus finanzas</p>
            <h3 id="plan-negocio" className="mt-4 text-2xl font-semibold tracking-tight">{negocio.name}</h3>
            <p className="mt-4 flex flex-wrap items-baseline gap-x-2"><span className="text-5xl font-semibold tracking-tight tabular-nums">{whole.format(negocio.price)}</span><span className="text-base text-muted-foreground">{CURRENCY} / mes + IVA</span></p>
            <p className="mt-3 text-sm text-muted-foreground">Total estimado con el cargo por servicio de pago e IVA: <span className="font-medium text-foreground tabular-nums">{m(br.total)} al mes</span>. <a href="#costos" className="underline underline-offset-2">Cómo se calcula</a>.</p>
            <p className="mt-5 text-sm">Incluye todo lo de <span className="font-medium">{control.name}</span>: compras con tus proveedores, facturas ligadas a tus gastos y ventas, reportes y exportaciones para tu contador.</p>
            <div className="mt-auto pt-8">
              <Link href="/registro" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full justify-center text-base sm:w-auto sm:px-6")}>Empezar con Negocio<ArrowRight className="size-4" aria-hidden /></Link>
              <p className="mt-3 text-xs text-muted-foreground">Primero creas tu cuenta; el plan lo eliges y lo pagas en Suscripción. No se cobra nada al registrarte.</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Con Negocio puedes:</p>
            <ul className="mt-4 space-y-5">{NEGOCIO_BENEFITS.map((b) => (
              <li key={b.title} className="flex gap-3"><Check className="mt-1 size-4 shrink-0" aria-hidden /><div><p className="font-medium">{b.title}</p><p className="mt-1 text-sm text-muted-foreground">{b.text}</p></div></li>))}</ul>
            <p className="mt-6 border-t pt-4 text-sm text-muted-foreground">También incluye el portal de autofacturación para tus clientes (consume tus timbres) y aprobaciones de compras de varios niveles.</p>
          </div>
        </article>

        <h3 className="mt-14 text-center text-lg font-semibold tracking-tight">Otros planes</h3>
        <p className="mt-1 text-center text-sm text-muted-foreground">Si todavía no necesitas lo fiscal, o necesitas conectar tu ERP.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">{others.map((p) => <SmallPlan key={p.id} plan={p} />)}</div>

        <details className="group mx-auto mt-8 max-w-5xl rounded-2xl border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">Comparar todos los planes<span aria-hidden className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">+</span></summary>
          <div className="relative overflow-x-auto border-t">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">Qué incluye cada plan</caption>
              <thead><tr className="border-b bg-muted/40"><th scope="col" className="px-4 py-3 text-left font-medium">Función</th>{FINANCE_PLANS.map((p) => <th key={p.id} scope="col" className="px-3 py-3 text-center font-medium">{p.name}</th>)}</tr></thead>
              <tbody>{COMPARISON.map((row) => (
                <tr key={row.label} className="border-b last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">{row.label}</th>
                  {FINANCE_PLANS.map((p) => <td key={p.id} className="px-3 py-2.5 text-center">{planIncludes(p.id, row.feature) ? <><Check className="mx-auto size-4" aria-hidden /><span className="sr-only">Incluido</span></> : <><span aria-hidden className="text-muted-foreground">—</span><span className="sr-only">No incluido</span></>}</td>)}
                </tr>))}</tbody>
            </table>
          </div>
        </details>
      </section>

      <section id="costos" aria-labelledby="costos-titulo" className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 id="costos-titulo" className="text-3xl font-semibold tracking-tight">Lo que se paga aparte, sin sorpresas.</h2>
            <p className="mt-3 text-muted-foreground">Además del plan hay tres conceptos. Esto es todo lo que se cobra hoy.</p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border bg-background p-6">
              <h3 className="font-semibold tracking-tight">Timbres de CFDI</h3>
              <p className="mt-2 text-sm text-muted-foreground">Cada factura que emites consume un timbre. Se compran en paquetes de créditos, aparte de cualquier plan, y solo se descuentan cuando el timbrado sale bien.</p>
              <ul className="mt-4 divide-y rounded-xl border text-sm">{STAMP_PACKS.proposed.map((p) => <li key={p.cfdi} className="flex items-center justify-between gap-3 px-3 py-2"><span>{p.cfdi} timbres</span><span className="tabular-nums">{m(p.priceMinor)} + IVA</span></li>)}</ul>
              <p className="mt-3 text-xs text-muted-foreground">A estos precios se suma el cargo por servicio de pago.</p>
            </div>
            <div className="rounded-2xl border bg-background p-6">
              <h3 className="font-semibold tracking-tight">Recuperación de CFDI del SAT</h3>
              <p className="mt-2 text-sm text-muted-foreground">Está incluida desde {FINANCE_PLANS.find((p) => p.id === SAT_RECOVERY.includedIn[0])!.name}, pero tiene <span className="font-medium text-foreground">límites de uso</span> y depende de las condiciones del proveedor del servicio y de que cargues tu e.firma en su panel. No es ilimitada y es un servicio distinto al timbrado.</p>
              <p className="mt-3 text-xs text-muted-foreground">Hoy no se cobra un excedente: si se define alguno, se te avisará antes de aplicarlo.</p>
            </div>
            <div className="rounded-2xl border bg-background p-6">
              <h3 className="font-semibold tracking-tight">{SERVICE_FEE.label} (4%)</h3>
              <p className="mt-2 text-sm text-muted-foreground">Cada pago en la pantalla de cobro suma un cargo de {Math.round(SERVICE_FEE.rate * 100)}% sobre el precio, y el IVA de 16% se calcula sobre ambos. Es obligatorio y aplica tanto a la suscripción como a los timbres.</p>
              <dl className="mt-4 divide-y rounded-xl border text-sm">
                <div className="flex justify-between gap-3 px-3 py-2"><dt>Plan Negocio</dt><dd className="tabular-nums">{m(br.price)}</dd></div>
                <div className="flex justify-between gap-3 px-3 py-2"><dt>Cargo por servicio de pago</dt><dd className="tabular-nums">{m(br.fee)}</dd></div>
                <div className="flex justify-between gap-3 px-3 py-2"><dt>IVA (16%)</dt><dd className="tabular-nums">{m(br.tax)}</dd></div>
                <div className="flex justify-between gap-3 px-3 py-2 font-medium"><dt>Total estimado al mes</dt><dd className="tabular-nums">{m(br.total)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Es una estimación: el importe final, con sus centavos, se muestra en la pantalla de pago antes de que confirmes.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
