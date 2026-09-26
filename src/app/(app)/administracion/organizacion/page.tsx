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
  requester_can_self_approve: boolean; reapproval_policy: string; auto_close_days_after_resolved: number | null; portal_enabled: boolean; portal_welcome_text: string | null;
}
const JOIN = [{ value: "INVITE_ONLY", label: "Solo por invitación" }, { value: "REQUEST_APPROVAL", label: "Solicitud con aprobación" }];
const REL = [{ value: "MANUAL_APPROVAL", label: "Aprobar cada solicitud manualmente" }, { value: "AUTO_ACCEPT_VIA_INVITATION_ONLY", label: "Aceptar automático solo con invitación" }];
const REAPP = [{ value: "ALWAYS", label: "Siempre que se edite" }, { value: "IF_AMOUNT_INCREASES", label: "Solo si el monto aumenta" }, { value: "NEVER", label: "Nunca" }];

export default function Organizacion() {
  const session = useSession();
  const q = useQuery({ queryKey: ["org-full"], queryFn: () => api<OrgResp>("/organization") });
  if (q.isLoading || !q.data) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {session.can("organization.update") && <General org={q.data.organization} />}
      {session.can("settings.manage") && q.data.settings && <SettingsCard s={q.data.settings} />}
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
    reapproval_policy: f.reapproval_policy, auto_close_days_after_resolved: f.auto_close === "" ? null : Number(f.auto_close), portal_enabled: f.portal_enabled, portal_welcome_text: f.welcome.trim() || null } }));
  const sel = (label: string, items: { value: string; label: string }[], key: "membership_join_policy" | "relationship_request_policy" | "reapproval_policy") => (
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
