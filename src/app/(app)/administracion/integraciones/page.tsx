"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, RefreshCw, Send, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateTime } from "@/lib/format";
import type { Tone } from "@/lib/ui/status";

interface ApiKey { id: string; name: string; key_prefix: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; created_at: string; roles: { id: string; name: string }[] }
interface Role { id: string; name: string; is_active: boolean }
interface Endpoint { id: string; url: string; event_types: string[]; payload_mode: string; is_active: boolean; consecutive_failures: number; disabled_reason: string | null; created_at: string }
interface Delivery { id: string; event_id: string; attempt: number; status: string; response_status: number | null; error: string | null; created_at: string; delivered_at: string | null }

const EVENT_TYPES = ["requisition.submitted", "requisition.approved", "requisition.rejected", "requisition.changes_requested", "requisition.cancelled", "requisition.closed", "rfq.issued", "rfq.viewed", "rfq.declined", "rfq.withdrawn",
  "quotation.submitted", "quotation.accepted", "quotation.rejected", "order.created", "order.confirmed", "order.rejected", "order.started", "order.cancelled", "order.completed", "delivery.created", "receipt.confirmed", "message.posted",
  "relationship.requested", "relationship.accepted", "relationship.rejected", "relationship.suspended", "relationship.reactivated", "relationship.finalized"];
const DELIVERY: Record<string, { label: string; tone: Tone }> = { PENDING: { label: "Pendiente", tone: "warn" }, SUCCEEDED: { label: "Entregado", tone: "ok" }, FAILED: { label: "Falló", tone: "bad" }, EXHAUSTED: { label: "Agotado", tone: "bad" } };

export default function Integraciones() {
  const s = useSession();
  return (
    <div className="space-y-6">
      {s.can("api_key.manage") && <ApiKeys />}
      {s.can("webhook.manage") && <Webhooks />}
      <Card><CardHeader><CardTitle>Feed de eventos (alternativa sin endpoint)</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Si tu sistema no puede recibir webhooks, consulta los eventos con una API key:</p>
        <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground">GET /api/v1/events?since=&lt;cursor&gt;&amp;types=order.created,order.confirmed{"\n"}Authorization: Bearer pk_live_…</pre>
        <p>Cada respuesta trae <code>next_cursor</code>; úsalo como <code>since</code> en la siguiente consulta.</p>
      </CardContent></Card>
    </div>
  );
}

function SecretDialog({ title, secret, onClose }: { title: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Cópialo ahora: por seguridad no se vuelve a mostrar completo.</DialogDescription></DialogHeader>
      <div className="flex gap-2"><Input readOnly aria-label="Secreto" className="font-mono text-xs" value={secret} onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={async () => { await navigator.clipboard?.writeText(secret); setCopied(true); }}><Copy />{copied ? "Copiado" : "Copiar"}</Button></div>
      <DialogFooter><Button onClick={onClose}>Ya lo guardé</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [revoke, setRevoke] = useState<ApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<{ data: ApiKey[] }>("/organization/api-keys") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["api-keys"] });
  async function rotate(k: ApiKey) {
    setError(null);
    try { const r = await api<{ secret: string }>(`/organization/api-keys/${k.id}/rotate`, { method: "POST", body: {} }); setSecret({ title: `Nueva llave para “${k.name}”`, value: r.secret }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo rotar."); }
  }
  return (
    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />Llaves de API</CardTitle><Button size="sm" onClick={() => setCreateOpen(true)}><Plus />Nueva llave</Button></div></CardHeader>
      <CardContent className="space-y-3 px-0">
        <p className="px-4 text-sm text-muted-foreground">Para que tu ERP use la misma API que esta aplicación. Cada llave tiene los permisos de los roles que elijas.</p>
        {error && <p role="alert" className="mx-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        {(keys.data?.data.length ?? 0) === 0 ? <p className="px-4 text-sm text-muted-foreground">Sin llaves.</p> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Llave</TableHead><TableHead>Roles</TableHead><TableHead>Último uso</TableHead><TableHead>Estado</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{keys.data!.data.map((k) => {
              const revoked = !!k.revoked_at; const expired = !!k.expires_at && new Date(k.expires_at) <= new Date();
              return (
                <TableRow key={k.id} className={revoked ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{k.name}</TableCell><TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                  <TableCell className="text-muted-foreground">{k.roles.map((r) => r.name).join(", ")}</TableCell>
                  <TableCell className="text-muted-foreground">{k.last_used_at ? dateTime(k.last_used_at) : "Nunca"}</TableCell>
                  <TableCell><StatusBadge label={revoked ? "Revocada" : expired ? "Vencida" : "Activa"} tone={revoked ? "bad" : expired ? "warn" : "ok"} /></TableCell>
                  <TableCell className="text-right">{!revoked && <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => void rotate(k)}><RefreshCw />Rotar</Button><Button size="sm" variant="ghost" onClick={() => setRevoke(k)}>Revocar</Button></div>}</TableCell>
                </TableRow>);
            })}</TableBody>
          </Table></div>)}
      </CardContent>
      {createOpen && <CreateKey onClose={() => setCreateOpen(false)} onCreated={async (v) => { setCreateOpen(false); setSecret({ title: "Llave creada", value: v }); await refresh(); }} />}
      {secret && <SecretDialog title={secret.title} secret={secret.value} onClose={() => setSecret(null)} />}
      <ActionDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} title="Revocar llave" description={revoke ? `${revoke.name}: dejará de funcionar de inmediato.` : undefined} fieldLabel="Motivo (solo para ti)" destructive confirmLabel="Revocar" onConfirm={async () => { await api(`/organization/api-keys/${revoke!.id}`, { method: "DELETE" }); await refresh(); }} />
    </Card>
  );
}

function CreateKey({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/organization/roles") });
  const [name, setName] = useState(""); const [picked, setPicked] = useState<string[]>([]); const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function go() {
    setBusy(true); setError(null);
    try { const r = await api<{ secret: string }>("/organization/api-keys", { method: "POST", body: { name: name.trim(), role_ids: picked, expires_in_days: days ? Number(days) : undefined } }); onCreated(r.secret); }
    catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo crear."); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}><DialogContent>
      <DialogHeader><DialogTitle>Nueva llave de API</DialogTitle><DialogDescription>Solo puedes darle roles cuyos permisos tú también tienes. Para un ERP suele bastar un rol de compras.</DialogDescription></DialogHeader>
      <div className="space-y-1.5"><Label htmlFor="k-name">Nombre *</Label><Input id="k-name" placeholder="ERP producción" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Roles *</legend>{(roles.data?.data ?? []).filter((r) => r.is_active).map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />{r.name}</label>)}</fieldset>
      <div className="space-y-1.5"><Label htmlFor="k-days">Vence en (días, opcional)</Label><Input id="k-days" type="number" min={1} max={730} className="w-32" value={days} onChange={(e) => setDays(e.target.value)} /></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || !name.trim() || picked.length === 0}>Crear llave</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [log, setLog] = useState<Endpoint | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const eps = useQuery({ queryKey: ["webhooks"], queryFn: () => api<{ data: Endpoint[] }>("/organization/webhooks") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["webhooks"] });
  async function act(fn: () => Promise<unknown>) { setMsg(null); try { await fn(); await refresh(); } catch (e) { setMsg(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo completar la acción."); } }
  return (
    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2"><Webhook className="size-4" />Webhooks</CardTitle><Button size="sm" onClick={() => setCreateOpen(true)}><Plus />Nuevo endpoint</Button></div></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Procura te avisa por HTTPS cuando ocurre algo. Cada envío va firmado (<code>Procura-Signature</code>) y se reintenta si falla.</p>
        {msg && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">{msg}</p>}
        {(eps.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Sin endpoints.</p> : eps.data!.data.map((e) => (
          <div key={e.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><p className="truncate font-mono text-xs">{e.url}</p><p className="text-xs text-muted-foreground">{e.event_types.includes("*") ? "Todos los eventos" : `${e.event_types.length} tipos de evento`} · payload {e.payload_mode === "thin" ? "mínimo" : "completo"}</p></div>
              <div className="flex items-center gap-1.5"><StatusBadge label={e.is_active ? "Activo" : "Inactivo"} tone={e.is_active ? "ok" : "muted"} />{e.consecutive_failures > 0 && <StatusBadge label={`${e.consecutive_failures} fallos seguidos`} tone="warn" />}</div>
            </div>
            {e.disabled_reason && <p className="text-xs text-muted-foreground">Motivo: {e.disabled_reason}</p>}
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="outline" onClick={() => void act(async () => { const r = await api<{ message: string }>(`/organization/webhooks/${e.id}/test`, { method: "POST", body: {} }); setMsg(r.message); })}><Send />Enviar prueba</Button>
              <Button size="xs" variant="outline" onClick={() => setLog(e)}>Ver entregas</Button>
              <Button size="xs" variant="outline" onClick={() => void act(() => api(`/organization/webhooks/${e.id}`, { method: "PATCH", body: { is_active: !e.is_active } }))}>{e.is_active ? "Desactivar" : "Activar"}</Button>
            </div>
          </div>))}
      </CardContent>
      {createOpen && <CreateEndpoint onClose={() => setCreateOpen(false)} onCreated={async (s) => { setCreateOpen(false); setSecret(s); await refresh(); }} />}
      {secret && <SecretDialog title="Secreto de firma" secret={secret} onClose={() => setSecret(null)} />}
      {log && <DeliveriesDialog endpoint={log} onClose={() => setLog(null)} />}
    </Card>
  );
}

function CreateEndpoint({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const [url, setUrl] = useState("https://"); const [all, setAll] = useState(true); const [picked, setPicked] = useState<string[]>([]); const [thin, setThin] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  async function go() {
    setBusy(true); setError(null);
    try { const r = await api<{ secret: string }>("/organization/webhooks", { method: "POST", body: { url: url.trim(), event_types: all ? ["*"] : picked, payload_mode: thin ? "thin" : "full" } }); onCreated(r.secret); }
    catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo crear."); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Nuevo endpoint</DialogTitle><DialogDescription>Debe ser HTTPS y responder 2xx en pocos segundos.</DialogDescription></DialogHeader>
      <div className="space-y-1.5"><Label htmlFor="w-url">URL *</Label><Input id="w-url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Todos los eventos</label>
      {!all && <div className="grid gap-1 sm:grid-cols-2">{EVENT_TYPES.map((t) => <label key={t} className="flex items-center gap-2 font-mono text-xs"><input type="checkbox" checked={picked.includes(t)} onChange={() => toggle(t)} />{t}</label>)}</div>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={thin} onChange={(e) => setThin(e.target.checked)} /><span>Payload mínimo<span className="block text-xs text-muted-foreground">Solo el tipo y los ids; tu sistema consulta el detalle con la API.</span></span></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || !/^https:\/\/.+/.test(url.trim()) || (!all && picked.length === 0)}>Crear endpoint</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function DeliveriesDialog({ endpoint, onClose }: { endpoint: Endpoint; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["webhook-deliveries", endpoint.id], queryFn: () => api<{ data: Delivery[] }>(`/organization/webhooks/${endpoint.id}/deliveries`) });
  const [error, setError] = useState<string | null>(null);
  async function redeliver(d: Delivery) {
    setError(null);
    try { await api(`/organization/webhooks/${endpoint.id}/deliveries/${d.id}/redeliver`, { method: "POST", body: {} }); await qc.invalidateQueries({ queryKey: ["webhook-deliveries", endpoint.id] }); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo reenviar."); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Entregas</DialogTitle><DialogDescription className="truncate font-mono text-xs">{endpoint.url}</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {q.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : (q.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Aún no hay entregas. Envía una prueba.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Intento</TableHead><TableHead>Estado</TableHead><TableHead>Respuesta</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{q.data!.data.map((d) => (
            <TableRow key={d.id}>
              <TableCell>{dateTime(d.created_at)}</TableCell><TableCell>{d.attempt}</TableCell>
              <TableCell><StatusBadge {...(DELIVERY[d.status] ?? { label: d.status, tone: "neutral" as const })} /></TableCell>
              <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{d.response_status ?? d.error ?? "—"}</TableCell>
              <TableCell>{d.status !== "SUCCEEDED" && <Button size="xs" variant="outline" onClick={() => void redeliver(d)}>Reenviar</Button>}</TableCell>
            </TableRow>))}</TableBody>
        </Table>)}
    </DialogContent></Dialog>
  );
}
