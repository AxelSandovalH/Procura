"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api-client";
import { dateShort } from "@/lib/format";
import { FINANCE_PLANS, STAMP_PACKS, TAX_NOTE, chargeBreakdown } from "@/lib/commercial/plans";
import { money } from "@/lib/format";

interface Billing {
  access: "LEGACY" | "NEW" | "PLAN" | "LAPSED"; plan: "esencial" | "control" | "negocio" | null; grace_days: number; can_manage: boolean;
  subscription: { plan: string | null; status: string; current_period_end: string | null; cancel_at_period_end: boolean; grace_until: string | null; has_customer: boolean } | null;
  readiness: { enabled: boolean; webhook: boolean; tax_rate: boolean; plans: Record<string, boolean>; packs: Record<string, boolean> };
  credits: { required: boolean; balance: number; available: number; history: { id: string; delta: number; kind: string; note: string | null; created_at: string }[] };
}
const STATUS: Record<string, string> = { ACTIVE: "Activa", PAST_DUE: "Pago pendiente", CANCELED: "Cancelada", INCOMPLETE: "Incompleta", NONE: "Sin suscripción" };
const KIND: Record<string, string> = { PURCHASE: "Compra", CONSUME: "Timbrado", ADJUST: "Ajuste" };
const PACKS = [50, 100, 500];
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.detail ?? e.title) : f);

/** Plan, cobro con Stripe y créditos de timbrado de la organización. */
export default function PlanPage() {
  return <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-muted" />}><PlanInner /></Suspense>;
}

function PlanInner() {
  const sp = useSearchParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["billing"], queryFn: () => api<Billing>("/billing") });
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const d = q.data;
  async function go(key: string, path: string, body: unknown) {
    setBusy(key); setError(null);
    try { const r = await api<{ url: string }>(path, { body }); window.location.href = r.url; }
    catch (e) { setError(err(e, "No se pudo abrir el pago.")); setBusy(null); }
  }
  async function change(plan: string) {
    setBusy(plan); setError(null);
    try { await api("/billing/change-plan", { body: { plan } }); await new Promise((r) => setTimeout(r, 2500)); await qc.invalidateQueries({ queryKey: ["billing"] }); }
    catch (e) { setError(err(e, "No se pudo cambiar de plan.")); } finally { setBusy(null); }
  }
  if (!d) return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  const sub = d.subscription, ready = d.readiness;
  const result = sp.get("pago") ?? sp.get("creditos");
  return (
    <div className="space-y-6">
      <PageHeader title="Suscripción" description="Tu plan, el estado de tu pago y los créditos de timbrado." />
      {result === "ok" && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">Recibimos tu pago. Tu plan o tus créditos se actualizan en unos segundos; si no los ves, recarga la página.</p>}
      {result === "cancelado" && <p role="status" className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Cancelaste el pago: no se hizo ningún cargo.</p>}
      {!ready.enabled && <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">El cobro todavía no está activado en este entorno, por lo que no se puede contratar ni comprar créditos desde aquí.</p>}
      {!d.can_manage && <p role="note" className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Solo el administrador principal de la organización puede contratar, cambiar el plan o comprar créditos.</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Card><CardHeader><CardTitle>Tu plan</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {d.access === "NEW" && <p><b>Elige un plan para empezar.</b> Mientras tanto puedes registrar tus gastos y ventas; las demás funciones se activan al contratar. No hay periodo de prueba y no se cobra nada hasta que completes el pago en Stripe.</p>}
        {d.access === "LEGACY" && <p>Tu organización tiene <b>acceso completo</b> sin suscripción (cuenta anterior al cobro). Si contratas un plan, tu acceso será el de ese plan.</p>}
        {d.access === "PLAN" && <p>Plan <b>{FINANCE_PLANS.find((p) => p.id === d.plan)?.name ?? d.plan}</b> · {STATUS[sub?.status ?? "NONE"]}.{sub?.current_period_end ? ` Se renueva el ${dateShort(sub.current_period_end)}.` : ""}{sub?.cancel_at_period_end ? " Está programada para cancelarse al terminar el periodo." : ""}{sub?.status === "PAST_DUE" && sub.grace_until ? ` Tu pago falló: conservas el plan hasta el ${dateShort(sub.grace_until)}. Actualiza tu tarjeta para no perder el acceso.` : ""}</p>}
        {d.access === "LAPSED" && <p><b>Tu suscripción no está activa.</b> Conservas tus datos y las funciones básicas; las demás se reactivan al renovar tu plan. Nunca borramos tu información por falta de pago.</p>}
        {sub?.has_customer && d.can_manage && <Button variant="outline" disabled={busy === "portal" || !ready.enabled} onClick={() => void go("portal", "/billing/portal", {})}>{busy === "portal" ? "Abriendo…" : "Administrar suscripción (tarjeta, recibos, cancelar)"}</Button>}
      </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-3">
        {FINANCE_PLANS.map((p) => {
          const current = d.plan === p.id && d.access === "PLAN"; const subscribed = !!(sub && ["ACTIVE", "PAST_DUE"].includes(sub.status) && sub.plan); const can = d.can_manage && ready.enabled && ready.plans[p.id] && !current;
          return (
            <Card key={p.id} className={p.featured ? "border-foreground/60" : ""}><CardHeader><CardTitle className="flex items-center justify-between">{p.name}{current && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">Tu plan</span>}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p><span className="text-2xl font-semibold tabular-nums">${p.price.toLocaleString("es-MX")}</span> <span className="text-muted-foreground">MXN / mes + IVA</span></p>
                <p className="text-xs text-muted-foreground">Cada mes pagas aprox. {money(chargeBreakdown(p.price * 100).total)}: el precio, 4% de cargo por servicio de pago y 16% de IVA sobre ambos.</p>
                <ul className="space-y-1.5">{p.features.slice(0, 4).map((f) => <li key={f.text} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{f.text}</li>)}</ul>
                <Button className="w-full" variant={p.featured ? "default" : "outline"} disabled={!can || busy === p.id} onClick={() => void (subscribed ? change(p.id) : go(p.id, "/billing/checkout", { plan: p.id }))}>{current ? "Plan actual" : busy === p.id ? (subscribed ? "Cambiando…" : "Abriendo…") : !ready.plans[p.id] ? "No disponible aún" : subscribed ? `Cambiar a ${p.name}` : `Contratar ${p.name}`}</Button>
              </CardContent></Card>);
        })}
      </div>
      <p className="text-xs text-muted-foreground">{TAX_NOTE} Al cambiar de plan, Stripe prorratea la diferencia en tu siguiente cobro.</p>

      <Card><CardHeader><CardTitle>Créditos de timbrado</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
        <p>Cada factura (CFDI) que emites consume <b>un crédito</b>, solo cuando el timbrado resulta exitoso. Los créditos se compran aparte de la suscripción y no caducan.</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><p><span className="text-3xl font-semibold tabular-nums">{d.credits.available}</span> disponibles</p>{d.credits.available !== d.credits.balance && <p className="text-muted-foreground">Saldo {d.credits.balance} (hay emisiones en curso)</p>}</div>
        {!d.credits.required && <p className="text-xs text-muted-foreground">Mientras no compres un paquete, tu organización timbra con su propia cuenta del proveedor fiscal y no consume créditos. Al comprar el primer paquete, cada timbrado consumirá uno.</p>}
        <div className="flex flex-wrap gap-2">{PACKS.map((n) => <Button key={n} variant="outline" disabled={!d.can_manage || !ready.enabled || !ready.packs[n] || busy === `pack${n}`} onClick={() => void go(`pack${n}`, "/billing/credits", { pack: n })}>{busy === `pack${n}` ? "Abriendo…" : ready.packs[n] ? `Comprar ${n} créditos · ${money(chargeBreakdown(STAMP_PACKS.proposed.find((x) => x.cfdi === n)!.priceMinor).total)} con cargo e IVA` : `${n} créditos (no disponible aún)`}</Button>)}</div>
        {d.credits.history.length > 0 && (
          <div><p className="mb-1.5 font-medium">Movimientos</p>
            <ul className="divide-y rounded-lg border">{d.credits.history.map((h) => <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2"><span>{KIND[h.kind] ?? h.kind}{h.note ? ` · ${h.note}` : ""}<span className="block text-xs text-muted-foreground">{dateShort(h.created_at)}</span></span><span className={`tabular-nums font-medium ${h.delta > 0 ? "text-emerald-700" : ""}`}>{h.delta > 0 ? "+" : ""}{h.delta}</span></li>)}</ul></div>)}
      </CardContent></Card>
    </div>
  );
}
