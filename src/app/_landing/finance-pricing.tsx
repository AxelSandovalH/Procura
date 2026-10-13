import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COMPARISON, CURRENCY, FINANCE_PLANS, SAT_RECOVERY, STAMP_PACKS, TAX_NOTE, planIncludes, type FinancePlan } from "@/lib/commercial/plans";

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });

function PlanCard({ plan }: { plan: FinancePlan }) {
  const f = !!plan.featured;
  return (
    <article aria-labelledby={`fp-${plan.id}`} className={cn("relative flex flex-col rounded-2xl border bg-card p-6 transition-[translate,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none",
      f ? "order-first border-foreground/80 shadow-md ring-1 ring-foreground/10 md:order-none lg:-translate-y-2" : "hover:border-foreground/30 hover:shadow-sm")}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`fp-${plan.id}`} className="text-lg font-semibold tracking-tight">{plan.name}</h3>
        {f && <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Recomendado</span>}
      </div>
      <p className="mt-4 flex min-h-[4.25rem] flex-wrap content-end items-baseline gap-x-1.5">
        {plan.priceFrom && <span className="w-full text-sm text-muted-foreground">Desde</span>}
        <span className="text-4xl font-semibold tracking-tight tabular-nums">{mxn.format(plan.price)}</span>
        <span className="text-sm text-muted-foreground">{CURRENCY} / mes + IVA</span>
      </p>
      <p className="mt-3 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
      <Link href="/registro" className={cn(buttonVariants({ variant: f ? "default" : "outline", size: "lg" }), "mt-6 h-10 w-full justify-center text-sm focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background", f && "shadow-sm")}>
        Crear cuenta<ArrowRight className="size-4" aria-hidden /><span className="sr-only"> en el plan {plan.name}</span>
      </Link>
      <div className="mt-6 border-t pt-5">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{plan.inherits ? `Todo lo de ${plan.inherits}, y además:` : "Incluye:"}</p>
        <ul className="space-y-2.5 text-sm">
          {plan.features.map((x) => <li key={x.text} className="flex items-start gap-2.5"><Check className={cn("mt-0.5 size-4 shrink-0", f ? "text-foreground" : "text-muted-foreground")} aria-hidden />{x.text}</li>)}
        </ul>
      </div>
    </article>
  );
}

/** Planes de finanzas y fiscal. Los datos viven en `lib/commercial/plans.ts`; aquí no se inventa ninguna prestación ni cifra. */
export function FinancePricing() {
  return (
    <>
      <section id="precios" aria-labelledby="precios-titulo" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="precios-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Un solo sistema, cuatro planes.</h2>
          <p className="mt-4 text-lg text-muted-foreground">Compras, gastos, ventas y facturación juntos. Elige el plan según qué tanto quieres controlar; los servicios fiscales con costo variable se muestran aparte, para que sepas qué pagas y por qué.</p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {FINANCE_PLANS.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">{TAX_NOTE} Al crear tu cuenta no se realiza ningún cobro automático.</p>

        <div className="mx-auto mt-16 max-w-5xl">
          <h3 className="text-center text-xl font-semibold tracking-tight">Compara los planes</h3>
          <div className="relative mt-6 overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">Qué incluye cada plan</caption>
              <thead><tr className="border-b bg-muted/40"><th scope="col" className="px-4 py-3 text-left font-medium">Función</th>{FINANCE_PLANS.map((p) => <th key={p.id} scope="col" className={cn("px-3 py-3 text-center font-medium", p.featured && "text-foreground")}>{p.name}</th>)}</tr></thead>
              <tbody>{COMPARISON.map((row) => (
                <tr key={row.label} className="border-b last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">{row.label}</th>
                  {FINANCE_PLANS.map((p) => <td key={p.id} className="px-3 py-2.5 text-center">{planIncludes(p.id, row.feature) ? <><Check className="mx-auto size-4" aria-hidden /><span className="sr-only">Incluido</span></> : <><span aria-hidden className="text-muted-foreground">—</span><span className="sr-only">No incluido</span></>}</td>)}
                </tr>))}</tbody>
            </table>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <h3 className="text-center text-xl font-semibold tracking-tight">Tres conceptos, cada uno por separado</h3>
          <dl className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border p-5">
              <dt className="font-medium">Suscripción mensual</dt>
              <dd className="mt-2 text-sm text-muted-foreground">Es el precio del plan. Cubre el uso de Procura: registro, control, documentos, conciliación y reportes.</dd>
            </div>
            <div className="rounded-2xl border p-5">
              <dt className="font-medium">Recuperación de CFDI del SAT</dt>
              <dd className="mt-2 text-sm text-muted-foreground">Trae a Procura las facturas que te emitieron. Está incluida desde {FINANCE_PLANS.find((p) => p.id === SAT_RECOVERY.includedIn[0])!.name}, y sus límites dependen del plan y de la política de consumo. Es un servicio distinto al timbrado, con costos propios del proveedor fiscal, y no se promete un volumen ilimitado.</dd>
            </div>
            <div className="rounded-2xl border p-5">
              <dt className="font-medium">Timbrado de CFDI propios</dt>
              <dd className="mt-2 text-sm text-muted-foreground">Cada factura que emites consume un timbre, que no está incluido en ninguna suscripción. {STAMP_PACKS.available ? "Se compra en paquetes de créditos prepagados." : "Los paquetes de créditos de 50, 100 y 500 CFDI llegarán más adelante, con precios que se publicarán al activarse; mientras tanto el timbrado se paga con tu propia cuenta del proveedor fiscal."}</dd>
            </div>
          </dl>
        </div>

        <p className="mx-auto mt-10 max-w-3xl text-center text-sm text-muted-foreground">Tus proveedores no pagan para trabajar contigo: cotizan, confirman órdenes y registran entregas dentro del flujo sin contratar un plan. El acompañamiento en la puesta en marcha se cotiza aparte de la suscripción.</p>
      </section>
    </>
  );
}
