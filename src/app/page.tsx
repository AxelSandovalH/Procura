import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpen, ClipboardCheck, FileSearch, Handshake, Lock, PackageCheck, Plug, ShieldCheck, Store, Truck, Webhook } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pricing } from "./_landing/pricing";
import { LandingFooter, LandingHeader } from "./_landing/shell";
import { ProductPreview } from "./_landing/product-preview";

export const metadata: Metadata = {
  title: { absolute: "Procura — Compras entre organizaciones en un solo flujo" },
  description: "Requisiciones, aprobaciones, cotizaciones, órdenes y entregas entre quien compra y quien vende, en un solo lugar. Cada organización conserva lo suyo en privado. Con API y webhooks para tu ERP.",
  alternates: { canonical: "/" },
};

const FLOW = ["Requisición", "Aprobación", "Cotización", "Orden", "Entrega", "Recepción"];

const STEPS = [
  { icon: ClipboardCheck, title: "Pide", text: "Una persona autorizada crea la requisición: qué necesita, cuánto y para cuándo. Y si ya pidió algo parecido, puede duplicar la requisición anterior." },
  { icon: ShieldCheck, title: "Aprueba", text: "Flujos de aprobación por monto, con uno o varios niveles y aprobadores por rol, persona o jefe de área. Todo queda registrado." },
  { icon: FileSearch, title: "Cotiza y decide", text: "Compras pide cotización a sus proveedores y compara las respuestas lado a lado. Al aceptar una, la orden se genera sola." },
  { icon: PackageCheck, title: "Recibe", text: "El proveedor confirma la orden y registra entregas, incluso parciales. Quien compra confirma la recepción y señala discrepancias." },
];

const BUYERS = [
  "Requisiciones con aprobación según tus propias reglas de monto y área.",
  "Comparativo de cotizaciones lado a lado, con el menor precio por concepto resaltado.",
  "Tu presupuesto y precios estimados son privados: el proveedor nunca los ve.",
  "Consulta el catálogo que tus proveedores comparten contigo.",
  "Historial completo y bitácora de auditoría de cada decisión.",
];
const SUPPLIERS = [
  "Bandeja de solicitudes de tus clientes y cotización desde la plataforma, con versiones.",
  "Un portal propio (tuempresa/solicitar) para que tus clientes te pidan cotización.",
  "Tu catálogo es privado: compartes solo lo que quieras con cada cliente. Impórtalo desde Excel o CSV.",
  "Tus costos y notas internas nunca se muestran a quien compra.",
  "Confirma órdenes, registra entregas parciales y da seguimiento a las recepciones.",
];

const FAQ = [
  { q: "¿Mis proveedores también tienen que usar Procura?", a: "Para cotizar y recibir órdenes dentro de la plataforma, sí. Tú los invitas con un enlace o ellos te encuentran desde su portal, y siempre hace falta que ambas partes acepten la relación antes de operar." },
  { q: "¿Otros pueden ver mi información?", a: "No. Cada organización ve solo lo suyo. Lo que se comparte con la contraparte (una solicitud de cotización, una orden, una conversación) es explícito, y tu presupuesto, costos y notas internas nunca salen de tu organización. El aislamiento se aplica en la propia base de datos, no solo en la interfaz." },
  { q: "¿Se conecta con mi ERP?", a: "Sí. Procura tiene una API para crear requisiciones y consultar órdenes y entregas, y webhooks firmados para que tu sistema se entere de cada evento. También hay un feed de eventos para quien no pueda recibir webhooks." },
  { q: "¿Una persona puede estar en varias organizaciones?", a: "Sí. Un mismo usuario puede pertenecer a varias organizaciones y cambiar de una a otra; cada organización aprueba a sus miembros y decide sus permisos." },
  { q: "¿Procura maneja facturas o pagos?", a: "Por ahora no. Cubre desde la requisición hasta la recepción de lo comprado. Facturación y pagos quedan fuera del alcance actual." },
  { q: "¿Se borra algo?", a: "No. Cancelar, rechazar o retirar deja el registro con su motivo y quién lo hizo. Todo cambio importante queda en la bitácora." },
];

export default function Home() {
  return (
    <div className="min-h-screen scroll-smooth bg-background text-foreground">
      <LandingHeader />

      <main>
        {/* Portada */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground"><Handshake className="size-3.5" />Compradores y proveedores, en la misma plataforma</p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Compras entre organizaciones, en un solo flujo.</h1>
            <p className="max-w-xl text-lg text-muted-foreground">Requisiciones, aprobaciones, cotizaciones, órdenes y entregas entre quien compra y quien vende. Sin hojas de cálculo ni correos perdidos, y cada organización conserva lo suyo en privado.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/registro" className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>Crear cuenta <ArrowRight className="size-4" /></Link>
              <Link href="/login" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5 text-base")}>Iniciar sesión</Link>
            </div>
            <p className="text-sm text-muted-foreground">Pensado para empresas que compran de forma recurrente a los mismos proveedores.</p>
          </div>
          <ProductPreview />
        </section>

        {/* Flujo */}
        <section aria-label="El flujo completo" className="border-y bg-muted/40">
          <ol className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-3 px-4 py-6 text-sm">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-full border bg-background px-3 py-1 font-medium">{s}</span>
                {i < FLOW.length - 1 && <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
              </li>))}
          </ol>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-20">
          <div className="max-w-2xl space-y-2">
            <h2 className="text-3xl font-semibold tracking-tight">Cómo funciona</h2>
            <p className="text-muted-foreground">De la necesidad a la recepción, cada paso con su responsable y su registro.</p>
          </div>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border p-5">
                <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><s.icon className="size-4" /></span><span className="text-xs font-medium text-muted-foreground">Paso {i + 1}</span></div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
              </li>))}
          </ol>
        </section>

        {/* Compradores y proveedores */}
        <section className="border-y bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:py-20 lg:grid-cols-2">
            <div id="compradores" className="scroll-mt-20 rounded-2xl border bg-background p-6 sm:p-8">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><BookOpen className="size-5" /></span>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">Para quien compra</h2>
              <ul className="mt-4 space-y-3 text-sm">{BUYERS.map((b) => <li key={b} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />{b}</li>)}</ul>
            </div>
            <div id="proveedores" className="scroll-mt-20 rounded-2xl border bg-background p-6 sm:p-8">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Store className="size-5" /></span>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">Para quien vende</h2>
              <ul className="mt-4 space-y-3 text-sm">{SUPPLIERS.map((b) => <li key={b} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />{b}</li>)}</ul>
            </div>
          </div>
        </section>

        {/* Privacidad */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-center">
            <div className="space-y-2">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Lock className="size-5" /></span>
              <h2 className="text-3xl font-semibold tracking-tight">Privado por defecto</h2>
              <p className="text-muted-foreground">Compartir con la contraparte es siempre una decisión explícita, nunca un efecto secundario.</p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              {[["Cada quien ve lo suyo", "Tus datos están aislados por organización a nivel de base de datos."], ["Lo compartido es explícito", "Una solicitud de cotización o una orden se comparte; tu presupuesto y tus costos, no."], ["Nada desaparece", "Se cancela o rechaza con motivo. La bitácora conserva quién hizo qué y cuándo."]].map(([t, d]) => (
                <div key={t} className="rounded-xl border p-4"><dt className="font-medium">{t}</dt><dd className="mt-1 text-sm text-muted-foreground">{d}</dd></div>))}
            </dl>
          </div>
        </section>

        {/* Integraciones */}
        <section id="integraciones" className="scroll-mt-20 border-y bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:items-center">
            <div className="space-y-4">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Plug className="size-5" /></span>
              <h2 className="text-3xl font-semibold tracking-tight">Conéctalo con tu ERP</h2>
              <p className="text-muted-foreground">Procura usa la misma API que su interfaz. Tu sistema puede originar requisiciones, consultar órdenes y entregas, y enterarse de todo lo que pasa.</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2"><Webhook className="size-4 shrink-0" />Webhooks firmados con reintentos automáticos</li>
                <li className="flex items-center gap-2"><Truck className="size-4 shrink-0" />Feed de eventos, si tu sistema no puede recibir webhooks</li>
                <li className="flex items-center gap-2"><ShieldCheck className="size-4 shrink-0" />Llaves de API con permisos por rol, revocables y rotables</li>
              </ul>
            </div>
            <pre className="overflow-x-auto rounded-xl border bg-background p-4 text-xs leading-relaxed sm:text-sm" tabIndex={0} aria-label="Ejemplo de llamada a la API"><code>{`POST /api/v1/requisitions
Authorization: Bearer pk_live_…

{
  "title": "Refacciones de cubierta",
  "external_reference": "PO-REQ-88213",
  "submit": true,
  "concepts": [{
    "concept_type": "GOOD", "source": "FREE",
    "name": "Ancla 15 kg",
    "quantity": 2, "unit_label": "PZA"
  }]
}

→ webhook: order.confirmed
  Procura-Signature: v1=…`}</code></pre>
          </div>
        </section>

        <Pricing />

        {/* Preguntas */}
        <section id="preguntas" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight">Preguntas frecuentes</h2>
          <div className="mt-8 divide-y rounded-xl border">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}<span aria-hidden className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </details>))}
          </div>
        </section>

        {/* Cierre */}
        <section className="border-t bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Empieza con tu organización.</h2><p className="mt-1 text-primary-foreground/70">Crea tu cuenta, configura tus reglas de aprobación e invita a tu equipo y a tus proveedores.</p></div>
            <Link href="/registro" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-11 shrink-0 px-5 text-base")}>Crear cuenta <ArrowRight className="size-4" /></Link>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
