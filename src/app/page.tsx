import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, DownloadCloud, FileCheck2, FilePlus2, Landmark, LineChart, ScanLine, Store, Truck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FinancePricing } from "./_landing/finance-pricing";
import { LandingFooter, LandingHeader } from "./_landing/shell";
import { ProductPreview } from "./_landing/product-preview";

export const metadata: Metadata = {
  title: { absolute: "ProcuraOS — Las cuentas de tu negocio, en orden" },
  description: "Controla tus gastos, organiza tus facturas y concilia tus movimientos bancarios desde un solo lugar. ProcuraOS mantiene tu información financiera organizada y lista para trabajar con tu contador.",
  alternates: { canonical: "/" },
};

/** Dónde suele estar hoy la información de un negocio (el problema que se resuelve). */
const SCATTERED = [
  { what: "Facturas", where: "en un sistema aparte" },
  { what: "Gastos", where: "en hojas de cálculo" },
  { what: "Movimientos", where: "en el banco" },
  { what: "Comprobantes", where: "entre correos, archivos y chats" },
];

/** Beneficios concretos. Cada uno cuenta qué problema quita; `plan` dice desde qué plan existe (lo aplica el sistema, ver lib/commercial/plans.ts). */
const BENEFITS = [
  { icon: ScanLine, title: "Registra gastos sin capturarlos", text: "Toma una foto o sube el PDF de un ticket o recibo: ProcuraOS extrae fecha, total y comercio para que no los teclees. Tú confirmas los datos antes de guardar.", plan: "Desde el plan Negocio" },
  { icon: DownloadCloud, title: "Reúne tus facturas del SAT", text: "Trae a ProcuraOS las facturas que te emitieron, sin depender solo de cargas manuales. Está sujeto a los límites de uso del servicio.", plan: "Desde el plan Negocio" },
  { icon: FileCheck2, title: "Cada gasto, con su factura", text: "Liga cada gasto o venta con su CFDI y ve de un vistazo cuáles ya están documentados y cuáles no. Si algo parece duplicado, te avisa.", plan: "Ligar facturas, desde Control · avisos de duplicados, desde Negocio" },
  { icon: Landmark, title: "Concilia tu banco con tus registros", text: "Importa los movimientos de tu estado de cuenta en CSV y recibe sugerencias para relacionarlos con tus gastos y ventas. Tú decides cuáles conciliar.", plan: "Desde el plan Negocio" },
  { icon: FilePlus2, title: "Factura desde el mismo lugar", text: "Emite CFDI 4.0 con su PDF, gestiona cancelaciones y aplica retenciones de RESICO según tu configuración fiscal. Los timbres se pagan por separado.", plan: "Desde el plan Negocio" },
  { icon: LineChart, title: "Información lista para tu contador", text: "Consulta tu resumen con gráficas y descarga tus gastos, ventas, facturas y movimientos en archivos que abren en Excel, además de los XML.", plan: "Desde el plan Control" },
];

const STEPS = [
  { title: "Crea tu cuenta", text: "Regístrate y crea tu organización. No se cobra nada al registrarte." },
  { title: "Elige tu plan", text: "En Suscripción eliges el plan y pagas con Stripe. Tu plan se activa en cuanto se confirma el pago." },
  { title: "Carga tu información", text: "Registra tus gastos, sube tus XML y fotos de tickets, e importa tus estados de cuenta. Para emitir facturas o traer tus CFDI del SAT configuras tu emisor fiscal; tu e.firma se carga en el panel del proveedor fiscal, nunca en ProcuraOS." },
];

const FAQ = [
  { q: "¿ProcuraOS es mi contabilidad?", a: "No. Te ayuda a mantener ordenados tus gastos, tus facturas y tus movimientos, y a preparar información para tu contador. No presenta declaraciones ni sustituye a tu contador, y no garantiza el cumplimiento fiscal: eso sigue siendo tuyo y de tu contador." },
  { q: "¿Quién timbra mis facturas?", a: "Un proveedor autorizado de timbrado (PAC) conectado a ProcuraOS: hoy Fiscalapi. Tus certificados se guardan en su panel, nunca en ProcuraOS, y cada factura se timbra solo cuando tú pulsas «Timbrar». Los timbres se compran aparte." },
  { q: "¿Se conecta directo a mi banco?", a: "No. La conciliación funciona con el archivo CSV de tu estado de cuenta: lo importas y ProcuraOS te sugiere con qué gasto o venta corresponde cada movimiento." },
  { q: "¿Otras personas pueden ver mi información?", a: "No. Cada organización ve solo lo suyo, y el aislamiento se aplica en la propia base de datos. Lo que se comparte con otra organización (una solicitud de cotización, una orden) es siempre una decisión explícita." },
  { q: "¿Qué plan me conviene?", a: "Esencial si solo quieres registrar tus gastos y ventas. Control si además compras a proveedores y quieres tus facturas ligadas y tus reportes. Negocio si quieres reunir tus CFDI del SAT, leer tickets, conciliar tu banco y facturar. Empresa si necesitas conectar tu ERP o tu punto de venta por API." },
  { q: "¿Mis proveedores pagan un plan?", a: "No. Cotizan, confirman órdenes y registran entregas dentro del flujo sin contratar nada. Solo paga quien compra y administra la organización." },
  { q: "¿Se borra algo?", a: "No. Cancelar, rechazar o retirar deja el registro con su motivo y quién lo hizo. Si tu suscripción deja de estar activa, conservas tus datos." },
];

export default function Home() {
  return (
    <div className="min-h-screen scroll-smooth bg-background text-foreground">
      <LandingHeader />
      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-6">
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Las cuentas de tu negocio, en orden.</h1>
            <p className="max-w-xl text-lg text-muted-foreground">Controla tus gastos, organiza tus facturas y concilia tus movimientos bancarios desde un solo lugar. ProcuraOS te ayuda a mantener tu información financiera organizada y lista para trabajar con tu contador.</p>
            <div className="flex flex-wrap gap-3">
              <a href="#precios" className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>Conocer los planes <ArrowRight className="size-4" /></a>
              <Link href="/registro" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5 text-base")}>Crear mi cuenta</Link>
            </div>
            <p className="text-sm text-muted-foreground">Al crear tu cuenta no se realiza ningún cobro automático: tú eliges tu plan.</p>
          </div>
          <ProductPreview />
        </section>

        {/* 1. El problema */}
        <section id="problema" className="scroll-mt-20 border-y bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:items-center">
            <div className="space-y-4">
              <h2 className="text-3xl font-semibold tracking-tight">Tu información financiera está repartida.</h2>
              <p className="text-muted-foreground">Cuando cada cosa vive en un lugar distinto, buscar una factura, revisar tus cuentas o juntar todo para tu contador se convierte en trabajo cada mes. ProcuraOS centraliza esa información y relaciona cada operación con su comprobante fiscal y su movimiento bancario.</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">{SCATTERED.map((s) => (
              <li key={s.what} className="rounded-xl border bg-background p-4"><p className="text-sm text-muted-foreground">{s.what}</p><p className="mt-1 font-medium">{s.where}</p></li>))}</ul>
          </div>
        </section>

        {/* 2 y 3. Qué puedes hacer y cuánto trabajo te ahorra */}
        <section id="beneficios" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-20">
          <div className="max-w-2xl space-y-2">
            <h2 className="text-3xl font-semibold tracking-tight">Todo en un lugar, y relacionado entre sí.</h2>
            <p className="text-muted-foreground">Menos tiempo buscando facturas y capturando comprobantes; más claridad sobre lo que entra, lo que sale y lo que falta documentar.</p>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <li key={b.title} className="flex flex-col rounded-2xl border p-6">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><b.icon className="size-4" aria-hidden /></span>
                <h3 className="mt-4 font-semibold tracking-tight">{b.title}</h3>
                <p className="mt-1.5 flex-1 text-sm text-muted-foreground">{b.text}</p>
                <p className="mt-4 text-xs font-medium text-foreground/70">{b.plan}</p>
              </li>))}
          </ul>
          <p className="mt-6 text-xs text-muted-foreground">ProcuraOS es una herramienta de organización: no es contabilidad ni declaración de impuestos, y no promete automatizar todo el proceso.</p>
        </section>

        {/* Compras: oferta diferenciada */}
        <section id="compras" className="border-y bg-muted/40">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:py-16 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Store className="size-5" aria-hidden /></span>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">¿También compras a proveedores?</h2>
              <p className="mt-2 text-muted-foreground">ProcuraOS incluye el flujo de compras: requisiciones, aprobaciones por monto, cotizaciones con comparativo y órdenes con recepción. Tus proveedores cotizan y registran entregas sin pagar nada. Disponible desde el plan Control; conectar tu ERP o tu punto de venta por API es parte del plan Empresa.</p>
            </div>
            <a href="#precios" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "shrink-0")}><Truck className="size-4" aria-hidden />Ver qué plan incluye compras</a>
          </div>
        </section>

        {/* 4 y 5. Precios y costos adicionales */}
        <FinancePricing />

        {/* 6. Cómo empiezo */}
        <section id="empezar" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-20">
          <div className="max-w-2xl space-y-2"><h2 className="text-3xl font-semibold tracking-tight">Cómo empiezas.</h2><p className="text-muted-foreground">Tres pasos, sin instalar nada.</p></div>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border p-6"><span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span><h3 className="mt-4 font-semibold tracking-tight">{s.title}</h3><p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p></li>))}
          </ol>
        </section>

        {/* Preguntas */}
        <section id="preguntas" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-16 sm:pb-20">
          <h2 className="text-3xl font-semibold tracking-tight">Preguntas frecuentes</h2>
          <div className="mt-8 divide-y rounded-xl border">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">{f.q}<span aria-hidden className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">+</span></summary>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </details>))}
          </div>
        </section>

        {/* CTA final */}
        <section className="border-t bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Empieza a poner las cuentas de tu negocio en orden.</h2><p className="mt-1 text-primary-foreground/70">Crea tu cuenta, elige tu plan y carga tu primera información.</p></div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link href="/registro" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-11 px-5 text-base")}>Crear mi cuenta <ArrowRight className="size-4" /></Link>
              <a href="#precios" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-5 text-base text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground")}>Conocer los planes</a>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
