import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AREAS, MODULES, PLAN_ORDER, isIncluded, type Module, type PlanId } from "../../_landing/modules";
import { CURRENCY, PLANS, formatMoney, type Plan } from "../../_landing/pricing-data";
import { Price } from "../../_landing/pricing";
import { ProductPreview } from "../../_landing/product-preview";
import { LandingFooter, LandingHeader } from "../../_landing/shell";

export const dynamicParams = false;
export function generateStaticParams() { return PLANS.map((p) => ({ plan: p.id })); }

export async function generateMetadata({ params }: { params: Promise<{ plan: string }> }): Promise<Metadata> {
  const { plan: id } = await params;
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) return {};
  return { title: `Plan ${plan.name}`, description: `${plan.description} Conoce los módulos incluidos en el plan ${plan.name} de Procura.`, alternates: { canonical: `/precios/${plan.id}` } };
}

const planName = (id: PlanId) => PLANS.find((p) => p.id === id)!.name;

function ModuleCard({ m, plan }: { m: Module; plan: Plan }) {
  const on = isIncluded(m, plan.id);
  const added = m.from === plan.id;
  const Icon = m.icon;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex size-10 items-center justify-center rounded-xl", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="size-5" aria-hidden /></span>
        {on ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <Check className="size-3" aria-hidden />{added && plan.id !== "starter" ? "Nuevo en este plan" : "Incluido"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><Lock className="size-3" aria-hidden />Desde {planName(m.from)}</span>
        )}
      </div>
      <h4 className={cn("mt-4 font-medium", !on && "text-muted-foreground")}>{m.name}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{m.text}</p>
    </>
  );
  const base = "flex flex-col rounded-2xl border p-5 transition-[translate,box-shadow,border-color] duration-200 motion-reduce:transition-none";
  return on
    ? <li className={cn(base, "bg-card hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm motion-reduce:hover:translate-y-0")}>{body}</li>
    : <li className={cn(base, "border-dashed bg-muted/30")}><Link href={`/precios/${m.from}`} className="flex h-full flex-col rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label={`${m.name}: disponible desde el plan ${planName(m.from)}`}>{body}</Link></li>;
}

export default async function PlanPage({ params }: { params: Promise<{ plan: string }> }) {
  const { plan: id } = await params;
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) notFound();
  const included = MODULES.filter((m) => isIncluded(m, plan.id));
  const added = MODULES.filter((m) => m.from === plan.id);
  const prev = PLAN_ORDER[PLAN_ORDER.indexOf(plan.id) - 1];
  const users = plan.features.find((f) => /usuarios/i.test(f));
  const support = plan.features.find((f) => /^soporte/i.test(f));
  const pct = Math.round((included.length / MODULES.length) * 100);

  return (
    <div className="min-h-screen scroll-smooth bg-background text-foreground">
      <LandingHeader base="/" />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:pt-14">
          <Link href="/#precios" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />Todos los planes</Link>
          <nav aria-label="Planes" className="mt-5 flex flex-wrap gap-2">
            {PLANS.map((p) => (
              <Link key={p.id} href={`/precios/${p.id}`} aria-current={p.id === plan.id ? "page" : undefined} className={cn("rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:outline-none", p.id === plan.id ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground")}>{p.name}</Link>))}
          </nav>

          <div className="mt-10 grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3"><h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{plan.name}</h1>{plan.badge && <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">{plan.badge}</span>}</div>
              <Price plan={plan} />
              <p className="max-w-xl text-lg text-muted-foreground">{plan.description}</p>
              <dl className="grid max-w-xl gap-3 text-sm sm:grid-cols-3">
                {[["Usuarios", users ?? "Según tu operación"], ["Soporte", support ?? "A la medida"], ["Implementación", plan.implementation.amount === null ? "Cotización" : `${formatMoney(plan.implementation.amount)} ${CURRENCY}${plan.implementation.plus ? "+" : ""}`]].map(([k, v]) => (
                  <div key={k} className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 font-medium">{v}</dd></div>))}
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={plan.cta.href} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base transition-all duration-150 active:translate-y-px motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background")}>{plan.cta.label}<ArrowRight className="size-4" aria-hidden /></Link>
                <p className="text-xs text-muted-foreground">La implementación se cotiza por separado de la suscripción mensual.</p>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section aria-labelledby="modulos-titulo" className="border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <div className="max-w-2xl space-y-3">
              <h2 id="modulos-titulo" className="text-3xl font-semibold tracking-tight">Módulos del plan {plan.name}</h2>
              <p className="text-muted-foreground">{prev ? `Incluye todo lo del plan ${planName(prev)}${added.length ? " y suma:" : "."}` : "Todo lo necesario para llevar tus compras de la requisición a la recepción."}</p>
            </div>
            <div className="mt-6 max-w-md space-y-2" aria-label={`${included.length} de ${MODULES.length} módulos incluidos`}>
              <div className="flex items-baseline justify-between text-sm"><span className="font-medium">{included.length} de {MODULES.length} módulos</span><span className="text-muted-foreground">{pct}% de la plataforma</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
            </div>

            {added.length > 0 && prev && (
              <div className="mt-10 rounded-2xl border border-foreground/20 bg-background p-5 sm:p-6">
                <h3 className="font-semibold">Lo que suma respecto a {planName(prev)}</h3>
                <ul className="mt-3 flex flex-wrap gap-2">{added.map((m) => <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm"><m.icon className="size-3.5" aria-hidden />{m.name}</li>)}</ul>
              </div>)}

            <div className="mt-12 space-y-12">
              {AREAS.map((a) => {
                const list = MODULES.filter((m) => m.area === a.id);
                const n = list.filter((m) => isIncluded(m, plan.id)).length;
                return (
                  <section key={a.id} aria-labelledby={`area-${a.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg border bg-background"><a.icon className="size-4" aria-hidden /></span><div><h3 id={`area-${a.id}`} className="font-semibold">{a.title}</h3><p className="text-sm text-muted-foreground">{a.text}</p></div></div>
                      <span className="text-sm text-muted-foreground tabular-nums">{n}/{list.length} incluidos</span>
                    </div>
                    <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((m) => <ModuleCard key={m.id} m={m} plan={plan} />)}</ul>
                  </section>);
              })}
            </div>
          </div>
        </section>

        <section aria-labelledby="plan-cta" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="flex flex-col items-start gap-6 rounded-2xl border p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
            <div className="max-w-xl"><h2 id="plan-cta" className="text-2xl font-semibold tracking-tight">¿Listo para empezar con {plan.name}?</h2><p className="mt-1.5 text-muted-foreground">Lleva requisiciones, aprobaciones, proveedores y órdenes a un solo sistema.</p></div>
            <Link href={plan.cta.href} className={cn(buttonVariants({ size: "lg" }), "h-11 shrink-0 px-5 text-base transition-all duration-150 active:translate-y-px motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background")}>{plan.cta.label}<ArrowRight className="size-4" aria-hidden /></Link>
          </div>
        </section>
      </main>
      <LandingFooter base="/" />
    </div>
  );
}
