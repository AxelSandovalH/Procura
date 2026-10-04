import Link from "next/link";
import { ArrowRight, Check, Handshake } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CURRENCY, PLANS, formatMoney, type Plan } from "./pricing-data";

/** Etiqueta de un precio: «$3,490» o «Desde $15,000». */
function Price({ plan }: { plan: Plan }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      {plan.priceFrom && <span className="w-full text-sm text-muted-foreground">Desde</span>}
      <span className="text-4xl font-semibold tracking-tight tabular-nums">{formatMoney(plan.price)}</span>
      <span className="whitespace-nowrap text-sm text-muted-foreground">{CURRENCY} / mes</span>
    </p>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const f = plan.featured;
  return (
    // En escritorio las 5 filas internas (encabezado, precio, descripción, CTA, funciones) se alinean entre tarjetas con subgrid.
    <article
      aria-labelledby={`plan-${plan.id}`}
      className={cn(
        "reveal relative flex flex-col rounded-2xl border bg-card p-6 transition-[translate,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none lg:row-span-5 lg:grid lg:grid-rows-subgrid lg:gap-y-0",
        f ? "order-first border-foreground/80 shadow-md ring-1 ring-foreground/10 hover:shadow-lg md:order-none lg:-translate-y-2 lg:hover:-translate-y-2.5"
          : "hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm motion-reduce:hover:translate-y-0",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`plan-${plan.id}`} className="text-lg font-semibold tracking-tight">{plan.name}</h3>
        {plan.badge && <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">{plan.badge}</span>}
      </div>
      <div className="mt-4"><Price plan={plan} /></div>
      <p className="mt-3 text-sm text-muted-foreground">{plan.description}</p>
      <div className="mt-6">
        <Link
          href={plan.cta.href}
          className={cn(buttonVariants({ variant: f ? "default" : "outline", size: "lg" }), "h-10 w-full justify-center text-sm transition-all duration-150 active:translate-y-px motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background", f && "shadow-sm")}
        >
          {plan.cta.label}<ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="mt-6 border-t pt-5">
        <p className="mb-3 text-xs font-medium text-muted-foreground">{plan.featuresLead}</p>
        <ul className="space-y-2.5 text-sm">
          {plan.features.map((x) => <li key={x} className="flex items-start gap-2.5"><Check className={cn("mt-0.5 size-4 shrink-0", f ? "text-foreground" : "text-muted-foreground")} aria-hidden />{x}</li>)}
        </ul>
      </div>
    </article>
  );
}

/** Precios, implementación y modelo de proveedores. Los planes viven en `pricing-data.ts`. */
export function Pricing() {
  return (
    <>
      <section id="precios" aria-labelledby="precios-titulo" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="precios-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Precios simples. Compras potentes.</h2>
          <p className="mt-4 text-lg text-muted-foreground">Todo lo que tu equipo necesita para gestionar compras, aprobaciones, proveedores y órdenes en un solo lugar.</p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[auto_auto_auto_auto_1fr] lg:gap-x-4 lg:gap-y-0">
          {PLANS.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Precios mensuales en pesos mexicanos ({CURRENCY}).</p>

        <div className="mx-auto mt-16 max-w-3xl rounded-2xl border bg-muted/30 p-6 sm:p-8">
          <h3 className="text-lg font-semibold tracking-tight">Implementación</h3>
          <p className="mt-1 text-sm text-muted-foreground">Configuración única adaptada a tu operación.</p>
          <dl className="mt-5 divide-y rounded-xl border bg-background text-sm">
            {PLANS.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="font-medium">{p.name}</dt>
                <dd className="tabular-nums text-muted-foreground">{p.implementation.amount === null ? "Cotización" : `${formatMoney(p.implementation.amount)} ${CURRENCY}${p.implementation.plus ? "+" : ""}`}</dd>
              </div>))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">La implementación se cotiza por separado de la suscripción mensual.</p>
        </div>
      </section>

      <section aria-labelledby="red-proveedores-titulo" className="border-y bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div className="space-y-4">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Handshake className="size-5" aria-hidden /></span>
            <h2 id="red-proveedores-titulo" className="text-3xl font-semibold tracking-tight">Tus proveedores no pagan para trabajar contigo.</h2>
            <p className="max-w-xl text-muted-foreground">Invita a tus proveedores a Procura y mantén tu flujo de compras conectado de la requisición a la entrega. Quien compra paga la plataforma; tus proveedores operan dentro del flujo sin necesidad de contratar un plan.</p>
          </div>
          <ul className="space-y-3 text-sm">
            {[["Tú pagas la plataforma", "El plan de tu organización cubre tu operación de compras."], ["Ellos operan sin costo", "Cotizan, confirman órdenes y registran entregas dentro del flujo."], ["Cada quien conserva lo suyo", "Lo que se comparte es explícito; costos y notas internas siguen privados."]].map(([t, d]) => (
              <li key={t} className="flex gap-3 rounded-xl border bg-background p-4"><Check className="mt-0.5 size-4 shrink-0" aria-hidden /><span><span className="block font-medium">{t}</span><span className="text-muted-foreground">{d}</span></span></li>))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="listo-titulo" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="flex flex-col items-start gap-6 rounded-2xl border p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div className="max-w-xl"><h2 id="listo-titulo" className="text-2xl font-semibold tracking-tight">¿Listo para modernizar tus compras?</h2><p className="mt-1.5 text-muted-foreground">Lleva requisiciones, aprobaciones, proveedores y órdenes a un solo sistema.</p></div>
          <Link href="/registro" className={cn(buttonVariants({ size: "lg" }), "h-11 shrink-0 px-5 text-base transition-all duration-150 active:translate-y-px motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background")}>Comenzar <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
      </section>
    </>
  );
}
