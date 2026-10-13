"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateTime } from "@/lib/format";

interface Status { configured: boolean; has_issuer: boolean; sync_enabled: boolean; rules: { id: string; downloadType: string | null; status: string | null }[]; requests: { total: number; ready: number; pending: number }; imports: { id: string; status: string; created_count: number; duplicate_count: number; error_count: number; updated_at: string }[]; last_synced_at: string | null }
interface Summary { rules: number; requested: number; request_errors: string[]; imported_requests: number; pending_requests: number; created: number; duplicates: number; errors: number; last_error: string | null; time_limited: boolean }
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.detail ?? e.title) : f);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Descarga masiva de CFDI del SAT con el proveedor fiscal: activar, pedir un periodo e importar lo que ya esté listo. */
export function SatDownloadCard({ onImported }: { onImported: () => Promise<unknown> }) {
  const { can } = useSession(); const qc = useQueryClient();
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86_400_000))); const [to, setTo] = useState(() => iso(new Date(Date.now() - 86_400_000)));
  const [issued, setIssued] = useState(false); const [busy, setBusy] = useState<"rules" | "sync" | "period" | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useQuery({ queryKey: ["fiscal-downloads"], queryFn: () => api<Status>("/fiscal/downloads"), enabled: can("cfdi.read"), staleTime: 30_000, retry: false });
  const s = q.data;
  if (!can("cfdi.manage") || !s?.configured || !s.has_issuer) return null;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["fiscal-downloads"] }), onImported()]);

  async function activate() {
    setBusy("rules"); setMsg(null);
    try { const r = await api<{ created: number }>("/fiscal/downloads/rules", { body: { directions: issued ? ["Recibidos", "Emitidos"] : ["Recibidos"] } }); setMsg({ ok: true, text: r.created > 0 ? `Listo: se crearon ${r.created} regla${r.created === 1 ? "" : "s"}. El SAT/Fiscalapi puede tardar en aprobarlas.` : "Las reglas ya existían; la sincronización quedó activada." }); await refresh(); }
    catch (e) { setMsg({ ok: false, text: err(e, "No se pudo activar la descarga masiva.") }); } finally { setBusy(null); }
  }
  async function sync(period: boolean) {
    setBusy(period ? "period" : "sync"); setMsg(null);
    try {
      const r = await api<Summary>("/fiscal/sync", { body: period ? { from, to } : {} });
      const parts = [`${r.created} factura${r.created === 1 ? "" : "s"} nueva${r.created === 1 ? "" : "s"}`, `${r.duplicates} ya existían`];
      if (r.errors) parts.push(`${r.errors} con error${r.last_error ? ` (${r.last_error})` : ""}`);
      if (period) parts.push(`${r.requested} solicitud${r.requested === 1 ? "" : "es"} pedida${r.requested === 1 ? "" : "s"} al SAT`);
      if (r.pending_requests) parts.push(`${r.pending_requests} en espera del SAT`);
      if (r.request_errors.length) parts.push(`avisos: ${r.request_errors.join(" | ")}`);
      setMsg({ ok: r.errors === 0 && r.request_errors.length === 0, text: parts.join(" · ") + (r.time_limited ? " · queda más por importar: vuelve a sincronizar." : "") }); await refresh();
    } catch (e) { setMsg({ ok: false, text: err(e, "No se pudo sincronizar.") }); } finally { setBusy(null); }
  }

  const last = s.imports[0];
  return (
    <div className="mb-4 space-y-3 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium"><DownloadCloud className="size-4" />Descarga masiva del SAT</p>
        {s.sync_enabled ? <Button size="sm" variant="outline" onClick={() => void sync(false)} disabled={!!busy}><RefreshCw />{busy === "sync" ? "Sincronizando…" : "Importar lo que ya esté listo"}</Button>
          : <Button size="sm" onClick={() => void activate()} disabled={!!busy}>{busy === "rules" ? "Activando…" : "Activar descarga de facturas recibidas"}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">
        {s.sync_enabled ? `Activada. Reglas: ${s.rules.map((r) => `${r.downloadType ?? "?"}${r.status ? ` (${r.status})` : ""}`).join(", ") || "—"}. Solicitudes: ${s.requests.ready} listas, ${s.requests.pending} esperando al SAT.${s.last_synced_at ? ` Última sincronización: ${dateTime(s.last_synced_at)}.` : ""} Cada hora se importan solas las que estén listas.`
          : "Trae automáticamente las facturas que te emitieron (recibidas) para ligarlas a tus gastos. Requiere el módulo de descarga masiva y tu e.firma cargada en Fiscalapi (en su panel, nunca en Procura). Tu plan cuenta un asiento por RFC y dirección."}
        {last && last.error_count > 0 ? ` Último intento con ${last.error_count} errores.` : ""}
      </p>
      {!s.sync_enabled && <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={issued} onChange={(e) => setIssued(e.target.checked)} />También las emitidas (necesita un segundo asiento en tu plan; tus facturas emitidas desde Procura ya se guardan solas)</label>}
      {s.sync_enabled && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="d-from" className="text-xs">Pedir periodo: desde</Label><Input id="d-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="d-to" className="text-xs">hasta</Label><Input id="d-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button size="sm" variant="outline" onClick={() => void sync(true)} disabled={!!busy || !from || !to}>{busy === "period" ? "Pidiendo…" : "Pedir al SAT"}</Button>
          <p className="basis-full text-xs text-muted-foreground">El SAT entrega los paquetes con retraso (a veces horas). Pide el periodo ahora y las facturas aparecerán solas en Facturas cuando estén listas.</p>
        </div>)}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-emerald-700" : "text-destructive"}>{msg.text}</p>}
    </div>
  );
}
