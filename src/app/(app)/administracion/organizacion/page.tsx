"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSyncedState } from "@/hooks/use-synced-state";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";

interface OrgResp { organization: { legal_name: string; display_name: string; tax_id: string | null; slug: string; is_discoverable: boolean; base_currency: string }; settings: Settings | null }
interface Settings {
  requisition_folio_prefix: string; allow_free_concepts: boolean; require_estimated_price: boolean; membership_join_policy: string; relationship_request_policy: string;
  requester_can_self_approve: boolean; reapproval_policy: string; approval_timing: string; expenses_managed_by: string; auto_close_days_after_resolved: number | null; portal_enabled: boolean; portal_welcome_text: string | null;
}
const JOIN = [{ value: "INVITE_ONLY", label: "Solo por invitación" }, { value: "REQUEST_APPROVAL", label: "Solicitud con aprobación" }];
const REL = [{ value: "MANUAL_APPROVAL", label: "Aprobar cada solicitud manualmente" }, { value: "AUTO_ACCEPT_VIA_INVITATION_ONLY", label: "Aceptar automático solo con invitación" }];
const TIMING = [{ value: "AFTER_QUOTING", label: "Después de cotizar (se aprueba la compra elegida)" }, { value: "BEFORE_QUOTING", label: "Antes de cotizar (se aprueba la requisición)" }];
const EXPENSES = [{ value: "PROCURA", label: "En Procura (Procura lleva los gastos)" }, { value: "ERP", label: "En mi ERP (Procura solo le entrega órdenes y facturas)" }];
const REAPP = [{ value: "ALWAYS", label: "Siempre que se edite" }, { value: "IF_AMOUNT_INCREASES", label: "Solo si el monto aumenta" }, { value: "NEVER", label: "Nunca" }];

export default function Organizacion() {
  const session = useSession();
  const q = useQuery({ queryKey: ["org-full"], queryFn: () => api<OrgResp>("/organization") });
  if (q.isLoading || !q.data) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {session.can("organization.update") && <General org={q.data.organization} />}
      {session.can("settings.manage") && q.data.settings && <SettingsCard s={q.data.settings} />}
      {session.can("cfdi.read") && <FiscalCard />}
    </div>
  );
}

function useSave(fn: () => Promise<unknown>) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await fn(); await Promise.all(["org-full", "org", "me"].map((k) => qc.invalidateQueries({ queryKey: [k] }))); setMsg("Guardado"); }
    catch (er) { setMsg(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return { busy, msg, save };
}

function General({ org }: { org: OrgResp["organization"] }) {
  const [f, setF] = useState({ display_name: org.display_name, legal_name: org.legal_name, tax_id: org.tax_id ?? "", discoverable: org.is_discoverable });
  const { busy, msg, save } = useSave(() => api("/organization", { method: "PATCH", body: { display_name: f.display_name.trim(), legal_name: f.legal_name.trim(), tax_id: f.tax_id.trim() || null, is_discoverable: f.discoverable } }));
  return (
    <Card><CardHeader><CardTitle>Datos de la organización</CardTitle></CardHeader><CardContent>
      <form className="space-y-3" onSubmit={save}>
        <div className="space-y-1.5"><Label htmlFor="o-dn">Nombre comercial</Label><Input id="o-dn" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="o-ln">Razón social</Label><Input id="o-ln" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="o-tx">RFC / ID fiscal</Label><Input id="o-tx" value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} /></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.discoverable} onChange={(e) => setF({ ...f, discoverable: e.target.checked })} /><span>Permitir que otras organizaciones me encuentren<span className="block text-xs text-muted-foreground">Por defecto eres invisible: solo te ven quienes ya tienen relación contigo o te invitaste.</span></span></label>
        <div className="flex items-center gap-3"><Button type="submit" disabled={busy}>Guardar</Button>{msg && <span role="status" className="text-xs text-muted-foreground">{msg}</span>}</div>
      </form></CardContent></Card>
  );
}

function SettingsCard({ s }: { s: Settings }) {
  const [f, setF] = useSyncedState(() => ({ ...s, auto_close: s.auto_close_days_after_resolved?.toString() ?? "", welcome: s.portal_welcome_text ?? "" }), JSON.stringify(s));
  const { busy, msg, save } = useSave(() => api("/organization/settings", { method: "PATCH", body: {
    requisition_folio_prefix: f.requisition_folio_prefix.trim(), allow_free_concepts: f.allow_free_concepts, require_estimated_price: f.require_estimated_price,
    membership_join_policy: f.membership_join_policy, relationship_request_policy: f.relationship_request_policy, requester_can_self_approve: f.requester_can_self_approve,
    reapproval_policy: f.reapproval_policy, approval_timing: f.approval_timing, expenses_managed_by: f.expenses_managed_by, auto_close_days_after_resolved: f.auto_close === "" ? null : Number(f.auto_close), portal_enabled: f.portal_enabled, portal_welcome_text: f.welcome.trim() || null } }));
  const sel = (label: string, items: { value: string; label: string }[], key: "membership_join_policy" | "relationship_request_policy" | "reapproval_policy" | "approval_timing" | "expenses_managed_by") => (
    <div className="space-y-1.5"><Label>{label}</Label><Select items={items} value={f[key]} onValueChange={(v) => setF({ ...f, [key]: v ?? f[key] })}><SelectTrigger className="w-full" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent></Select></div>);
  const chk = (label: string, key: "allow_free_concepts" | "require_estimated_price" | "requester_can_self_approve" | "portal_enabled", hint?: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.checked })} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>);
  return (
    <Card><CardHeader><CardTitle>Configuración</CardTitle></CardHeader><CardContent>
      <form className="space-y-3" onSubmit={save}>
        <div className="space-y-1.5"><Label htmlFor="c-pf">Prefijo de folio de requisiciones</Label><Input id="c-pf" className="w-32" value={f.requisition_folio_prefix} onChange={(e) => setF({ ...f, requisition_folio_prefix: e.target.value })} /></div>
        {chk("Permitir conceptos libres (sin catálogo)", "allow_free_concepts")}
        {chk("Exigir precio estimado en cada concepto", "require_estimated_price")}
        {chk("El solicitante puede aprobar sus propias requisiciones", "requester_can_self_approve")}
        {sel("¿Cuándo se aprueba?", TIMING, "approval_timing")}
        {sel("¿Dónde se llevan los gastos?", EXPENSES, "expenses_managed_by")}
        {sel("Reaprobación al editar", REAPP, "reapproval_policy")}
        {sel("Ingreso de nuevos miembros", JOIN, "membership_join_policy")}
        {sel("Solicitudes de relación", REL, "relationship_request_policy")}
        <div className="space-y-1.5"><Label htmlFor="c-ac">Cerrar automáticamente tras resolverse (días, vacío = nunca)</Label><Input id="c-ac" type="number" min={0} className="w-32" value={f.auto_close} onChange={(e) => setF({ ...f, auto_close: e.target.value })} /></div>
        {chk("Portal público de solicitudes activo", "portal_enabled", "Permite que clientes te soliciten cotización desde tu enlace público (siempre con inicio de sesión).")}
        {f.portal_enabled && <div className="space-y-1.5"><Label htmlFor="c-wt">Texto de bienvenida del portal</Label><Textarea id="c-wt" rows={3} value={f.welcome} onChange={(e) => setF({ ...f, welcome: e.target.value })} /></div>}
        <div className="flex items-center gap-3"><Button type="submit" disabled={busy}>Guardar configuración</Button>{msg && <span role="status" className="text-xs text-muted-foreground">{msg}</span>}</div>
      </form></CardContent></Card>
  );
}

interface FiscalSettings { expedition_zip_code?: string; series?: string; default_product_code?: string; default_unit_code?: string; issuer_name?: string; issuer_tax_id?: string }
interface FiscalInfo { provider: string; configured: boolean; environment: "test" | "live" | "custom" | null; capabilities: Record<string, boolean>; notes: string[]; connection: { status: string; external_account_id: string | null; settings: FiscalSettings } | null }
const CAPS: [string, string][] = [["issue", "Emitir CFDI"], ["fetchIssued", "Recuperar CFDI emitidos"], ["fetchReceived", "Recuperar CFDI recibidos"], ["statusLookup", "Consultar vigencia ante el SAT"], ["downloadXml", "Descargar XML"], ["downloadPdf", "Descargar PDF"]];

/** Estado real de la facturación electrónica: qué está configurado y qué capacidades existen de verdad. */
function FiscalCard() {
  const session = useSession(); const qc = useQueryClient();
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["fiscal-provider"], queryFn: () => api<FiscalInfo>("/fiscal/provider"), staleTime: 60_000 });
  if (!q.data) return null;
  async function probe() {
    setBusy(true); setTest(null);
    try { const r = await api<{ environment: string }>("/fiscal/test", { body: {} }); setTest({ ok: true, text: `Conexión correcta con Fiscalapi (ambiente de ${r.environment === "live" ? "producción" : r.environment === "test" ? "pruebas" : "personalizado"}).` }); }
    catch (e) { setTest({ ok: false, text: e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo probar la conexión." }); }
    finally { setBusy(false); await qc.invalidateQueries({ queryKey: ["fiscal-provider"] }); }
  }
  const p = q.data;
  return (
    <Card><CardHeader><CardTitle>Facturación electrónica (CFDI)</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p>Proveedor fiscal: <span className="font-medium capitalize">{p.provider}</span> · {p.configured ? "credenciales presentes en el servidor" : "sin configurar"}</p>
      <ul className="grid gap-1 sm:grid-cols-2">{CAPS.map(([k, name]) => <li key={k} className="flex items-center gap-2"><span aria-hidden className={p.capabilities[k] ? "text-emerald-600" : "text-muted-foreground"}>{p.capabilities[k] ? "●" : "○"}</span><span className={p.capabilities[k] ? "" : "text-muted-foreground"}>{name}{p.capabilities[k] ? "" : " — no disponible"}</span></li>)}</ul>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      {p.environment === "live" && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400">Ambiente de PRODUCCIÓN: cada factura emitida es real ante el SAT, consume un timbre y tiene valor fiscal.</p>}
      {p.environment === "test" && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">Ambiente de pruebas: las facturas no tienen valor fiscal.</p>}
      {p.configured && session.can("cfdi.manage") && <EmitterConfig conn={p.connection} onSaved={() => qc.invalidateQueries({ queryKey: ["fiscal-provider"] })} />}
      {session.can("cfdi.manage") && <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" onClick={() => void probe()} disabled={busy || !p.configured}>{busy ? "Probando…" : "Probar conexión"}</Button>{test && <span role={test.ok ? "status" : "alert"} className={`text-xs ${test.ok ? "text-emerald-700" : "text-destructive"}`}>{test.text}</span>}</div>}
      <p className="text-xs text-muted-foreground">Mientras tanto puedes cargar XML manualmente en Facturas; los de tus proveedores aparecen solos.</p>
    </CardContent></Card>
  );
}

interface Issuer { id: string; legalName: string; taxId: string; taxRegimeCode: string | null; zipCode: string | null }

/** Con qué emisor (persona con certificados en el proveedor) y con qué valores por omisión emite esta organización. */
function EmitterConfig({ conn, onSaved }: { conn: FiscalInfo["connection"]; onSaved: () => Promise<unknown> }) {
  const cur = conn?.settings ?? {};
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ issuer: conn?.external_account_id ?? "", zip: cur.expedition_zip_code ?? "", series: cur.series ?? "A", product: cur.default_product_code ?? "", unit: cur.default_unit_code ?? "E48" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const issuers = useQuery({ queryKey: ["fiscal-issuers"], queryFn: () => api<{ data: Issuer[] }>("/fiscal/issuers"), enabled: open });
  const chosen = issuers.data?.data.find((i) => i.id === f.issuer);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api("/fiscal/connection", { method: "PUT", body: { issuer_id: f.issuer, expedition_zip_code: f.zip, series: f.series, default_product_code: f.product || undefined, default_unit_code: f.unit || undefined } });
      await onSaved(); setMsg({ ok: true, text: "Emisor guardado." }); setOpen(false);
    } catch (er) { setMsg({ ok: false, text: er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo guardar." }); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Emisor de facturas</p><Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{conn?.external_account_id ? "Cambiar" : "Configurar emisor"}</Button></div>
      {conn?.external_account_id ? <p className="text-xs text-muted-foreground">{cur.issuer_name} · {cur.issuer_tax_id} · CP {cur.expedition_zip_code} · serie {cur.series}{cur.default_product_code ? ` · clave SAT ${cur.default_product_code}` : ""}</p> : <p className="text-xs text-muted-foreground">Aún no hay emisor: elige la persona (con su CSD) que firmará tus facturas.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-emerald-700" : "text-destructive"}`}>{msg.text}</p>}
      {open && (
        <form onSubmit={save} className="space-y-3 border-t pt-3">
          <div className="space-y-1.5"><Label htmlFor="f-iss">Emisor *</Label>
            <select id="f-iss" required className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={f.issuer} onChange={(e) => { const i = issuers.data?.data.find((x) => x.id === e.target.value); setF({ ...f, issuer: e.target.value, zip: f.zip || i?.zipCode || "" }); }}>
              <option value="">{issuers.isLoading ? "Cargando emisores…" : "Elige un emisor"}</option>{(issuers.data?.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.legalName} · {i.taxId}</option>)}</select>
            {chosen && <p className="text-xs text-muted-foreground">Régimen {chosen.taxRegimeCode ?? "—"} · CP {chosen.zipCode ?? "—"}</p>}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="f-zip">CP de expedición *</Label><Input id="f-zip" required inputMode="numeric" maxLength={5} value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-ser">Serie *</Label><Input id="f-ser" required maxLength={25} value={f.series} onChange={(e) => setF({ ...f, series: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-prod">Clave SAT de producto/servicio (por omisión)</Label><Input id="f-prod" inputMode="numeric" maxLength={8} placeholder="8 dígitos" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-unit">Clave SAT de unidad (por omisión)</Label><Input id="f-unit" maxLength={3} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value.toUpperCase() })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Las claves por omisión se usan en los conceptos que no tengan una propia. Confírmalas con tu contador: son las de tu actividad.</p>
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || !f.issuer || !f.zip}>Guardar emisor</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button></div>
        </form>)}
    </div>
  );
}
