"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Download, Link2, Plus, Unlink, Upload } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money, toMinor } from "@/lib/format";
import { PAYMENT_METHOD, SAT_STATUS } from "@/lib/ui/status";

export const apiErr = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);

export interface PaymentRow { id: string; paid_at: string; amount_minor: number | string; method: string | null; external_reference: string | null; notes: string | null; voided_at: string | null; void_reason: string | null }
export interface CfdiLinkRow { id: string; amount_minor: number | string; cfdi: { id: string; fiscal_uuid: string; series: string | null; folio: string | null; issuer_name: string | null; receiver_rfc: string; issuer_rfc: string; currency: string; total_minor: number | string; sat_status: string; direction: string } }
const cfdiLabel = (c: { series: string | null; folio: string | null; fiscal_uuid: string }) => [c.series, c.folio].filter(Boolean).join("-") || c.fiscal_uuid.slice(0, 8);

/** Cobros (venta) o pagos (gasto) parciales de una operación. `base` es /sales/{id} o /expenses/{id}. */
export function PaymentsSection({ base, payments, currency, pendingMinor, voided, kind, onChange }: { base: string; payments: PaymentRow[]; currency: string; pendingMinor: number | string; voided: boolean; kind: "sale" | "expense"; onChange: () => Promise<unknown> }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false); const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [f, setF] = useState({ paid_at: new Date().toISOString().slice(0, 10), amount: "", method: "TRANSFER", ref: "", notes: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const word = kind === "sale" ? { one: "cobro", add: "Registrar cobro", title: "Cobros" } : { one: "pago", add: "Registrar pago", title: "Pagos" };
  const canManage = can("payment.manage") && !voided;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(`${base}/payments`, { body: { paid_at: f.paid_at, amount_minor: toMinor(f.amount), method: f.method, external_reference: f.ref.trim() || undefined, notes: f.notes.trim() || undefined } }); await onChange(); setOpen(false); setF({ ...f, amount: "", ref: "", notes: "" }); }
    catch (er) { setError(apiErr(er, `No se pudo registrar el ${word.one}.`)); } finally { setBusy(false); }
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between"><h3 className="font-medium">{word.title}</h3>{canManage && Number(pendingMinor) > 0 && <Button size="sm" variant="outline" onClick={() => { setF({ ...f, amount: (Number(pendingMinor) / 100).toFixed(2) }); setOpen(true); }}><Plus />{word.add}</Button>}</div>
      {payments.length === 0 ? <p className="text-sm text-muted-foreground">Sin {word.title.toLowerCase()} registrados.</p> : (
        <ul className="space-y-1.5 text-sm">{payments.map((p) => (
          <li key={p.id} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${p.voided_at ? "opacity-60" : ""}`}>
            <span><span className="font-medium tabular-nums">{money(p.amount_minor, currency)}</span> <span className="text-muted-foreground">· {dateShort(p.paid_at)} · {p.method ? PAYMENT_METHOD[p.method] ?? p.method : "—"}{p.external_reference ? ` · ${p.external_reference}` : ""}</span>{p.voided_at && <span className="ml-2 text-xs">Anulado: {p.void_reason}</span>}</span>
            {canManage && !p.voided_at && <Button size="icon" variant="ghost" aria-label={`Anular ${word.one}`} onClick={() => setVoiding(p)}><Ban /></Button>}
          </li>))}</ul>)}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent>
        <DialogHeader><DialogTitle>{word.add}</DialogTitle><DialogDescription>Pendiente: {money(pendingMinor, currency)}. Puedes registrar un {word.one} parcial.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="p-date">Fecha *</Label><Input id="p-date" type="date" required value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="p-amt">Importe ({currency}) *</Label><Input id="p-amt" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="p-method">Método</Label><select id="p-method" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="space-y-1.5"><Label htmlFor="p-ref">Referencia</Label><Input id="p-ref" maxLength={200} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="Folio, últimos 4 dígitos…" /></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !f.amount.trim()}>Guardar</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>
      <ActionDialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)} title={`Anular ${word.one}`} description="No se borra: queda anulado con tu motivo y se recalcula el saldo." fieldLabel="Motivo" required destructive confirmLabel="Anular"
        onConfirm={async (c) => { await api(`${base}/payments/${voiding!.id}/void`, { body: { reason: c } }); await onChange(); }} />
    </section>
  );
}

/** CFDI ligados a una operación, con el importe que documenta cada uno y la diferencia contra el total. */
export function CfdiSection({ base, links, currency, totalMinor, documentedMinor, direction, voided, onChange }: { base: string; links: CfdiLinkRow[]; currency: string; totalMinor: number | string; documentedMinor: number | string; direction: "ISSUED" | "RECEIVED"; voided: boolean; onChange: () => Promise<unknown> }) {
  const { can } = useSession();
  const [pick, setPick] = useState(""); const [amount, setAmount] = useState(""); const [error, setError] = useState<string | null>(null); const [unlinking, setUnlinking] = useState<CfdiLinkRow | null>(null);
  const canManage = can("cfdi.manage") && !voided;
  const fileRef = useRef<HTMLInputElement>(null); const [uploading, setUploading] = useState(false);
  const options = useQuery({ queryKey: ["cfdi", "available", direction], queryFn: () => api<{ data: { id: string; fiscal_uuid: string; series: string | null; folio: string | null; issuer_name: string | null; receiver_name: string | null; total_minor: number | string; pending_to_allocate_minor: number | string; currency: string; cfdi_type: string; sat_status: string }[] }>(`/cfdi?direction=${direction}`), enabled: canManage });
  const linked = new Set(links.map((l) => l.cfdi.id));
  const avail = (options.data?.data ?? []).filter((c) => c.currency === currency && c.cfdi_type === "I" && c.sat_status !== "CANCELADO" && !linked.has(c.id) && Number(c.pending_to_allocate_minor) > 0);
  const diff = Number(totalMinor) - Number(documentedMinor);
  /** Sube el XML (y su PDF opcional) y lo liga a esta operación en un solo paso; si el CFDI ya estaba registrado, usa el existente. */
  async function uploadAndLink(files: FileList | null) {
    const xml = Array.from(files ?? []).find((f) => /\.xml$/i.test(f.name)); const pdf = Array.from(files ?? []).find((f) => /\.pdf$/i.test(f.name));
    if (fileRef.current) fileRef.current.value = "";
    if (!xml) { setError("Selecciona el archivo XML del CFDI (y, si quieres, su PDF)."); return; }
    setUploading(true); setError(null);
    try {
      const text = await xml.text(); const uuid = text.match(/UUID="([0-9A-Fa-f-]{36})"/)?.[1];
      const fd = new FormData(); fd.append("xml", xml); if (pdf) fd.append("pdf", pdf); fd.append("direction", direction);
      const res = await fetch("/api/v1/cfdi", { method: "POST", body: fd, credentials: "same-origin" }); const data = await res.json().catch(() => null);
      let cfdiId: string | undefined = data?.id;
      if (res.status === 409 && uuid) cfdiId = (await api<{ data: { id: string }[] }>(`/cfdi?direction=${direction}&q=${encodeURIComponent(uuid)}`)).data[0]?.id; // ya estaba registrado: se usa ese
      else if (!res.ok) throw new ApiError(res.status, data?.title ?? "Error", data?.detail);
      if (!cfdiId) throw new ApiError(409, "Conflicto", "Ese CFDI ya está registrado en otra dirección (emitido/recibido) de tu organización.");
      await api(`${base}/cfdi`, { body: { cfdi_id: cfdiId, ...(amount.trim() ? { amount_minor: toMinor(amount) } : {}) } });
      setAmount(""); await onChange();
    } catch (e) { await onChange().catch(() => {}); setError(apiErr(e, "No se pudo cargar y ligar el CFDI.")); } finally { setUploading(false); }
  }
  async function link() {
    if (!pick) return; setError(null);
    try { await api(`${base}/cfdi`, { body: { cfdi_id: pick, ...(amount.trim() ? { amount_minor: toMinor(amount) } : {}) } }); setPick(""); setAmount(""); await onChange(); }
    catch (e) { setError(apiErr(e, "No se pudo ligar el CFDI.")); }
  }
  async function download(cfdiId: string, kind: "xml" | "pdf") {
    setError(null);
    try {
      const d = await api<{ downloads: { xml_url: string | null; pdf_url: string | null } }>(`/cfdi/${cfdiId}`); const url = kind === "xml" ? d.downloads.xml_url : d.downloads.pdf_url;
      if (!url) { setError(kind === "xml" ? "Este CFDI no tiene el XML guardado en Procura." : "Este CFDI no tiene PDF guardado; genéralo desde Facturas."); return; }
      window.open(url, "_blank", "noopener");
    } catch (e) { setError(apiErr(e, "No se pudo descargar el archivo.")); }
  }
  return (
    <section className="space-y-2">
      <h3 className="font-medium">Comprobantes fiscales (CFDI)</h3>
      {links.length === 0 ? <p className="text-sm text-muted-foreground">Sin CFDI ligados.</p> : (
        <ul className="space-y-1.5 text-sm">{links.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
            <span className="min-w-0"><span className="font-medium">{cfdiLabel(l.cfdi)}</span> <span className="text-muted-foreground">· {l.cfdi.issuer_name ?? l.cfdi.issuer_rfc} · CFDI {money(l.cfdi.total_minor, l.cfdi.currency)} · documenta </span><span className="font-medium tabular-nums">{money(l.amount_minor, currency)}</span></span>
            <span className="flex shrink-0 items-center gap-1.5"><Button size="sm" variant="ghost" aria-label="Descargar XML del CFDI" onClick={() => void download(l.cfdi.id, "xml")}><Download />XML</Button><Button size="sm" variant="ghost" aria-label="Descargar PDF del CFDI" onClick={() => void download(l.cfdi.id, "pdf")}><Download />PDF</Button><StatusBadge {...(SAT_STATUS[l.cfdi.sat_status] ?? { label: l.cfdi.sat_status, tone: "neutral" as const })} />{canManage && <Button size="icon" variant="ghost" aria-label="Desligar CFDI" onClick={() => setUnlinking(l)}><Unlink /></Button>}</span>
          </li>))}</ul>)}
      <p className={`text-sm ${links.length > 0 && diff !== 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
        Documentado {money(documentedMinor, currency)} de {money(totalMinor, currency)}
        {links.length > 0 && diff > 0 && ` · faltan ${money(diff, currency)} por documentar`}{links.length > 0 && diff < 0 && ` · hay ${money(-diff, currency)} documentados de más`}
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <select aria-label="CFDI a ligar" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{avail.length === 0 ? "No hay CFDI disponibles (carga uno en Facturas)" : "Ligar un CFDI…"}</option>
            {avail.map((c) => <option key={c.id} value={c.id}>{cfdiLabel(c)} · {c.issuer_name ?? c.receiver_name ?? "—"} · disponible {money(c.pending_to_allocate_minor, c.currency)}</option>)}
          </select>
          <Input aria-label="Importe a documentar" className="w-36" inputMode="decimal" placeholder="Importe (opcional)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button variant="outline" onClick={() => void link()} disabled={!pick}><Link2 />Ligar</Button>
          <input ref={fileRef} type="file" multiple accept=".xml,.pdf,text/xml,application/xml,application/pdf" className="sr-only" aria-label="Archivo XML del CFDI" onChange={(e) => void uploadAndLink(e.target.files)} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload />{uploading ? "Cargando…" : "Cargar XML y ligar"}</Button>
        </div>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ActionDialog open={!!unlinking} onOpenChange={(o) => !o && setUnlinking(null)} title="Desligar CFDI" description="La operación volverá a quedar sin documentar por ese importe. La acción queda en el historial." fieldLabel="Motivo" required destructive confirmLabel="Desligar"
        onConfirm={async (c) => { await api(`${base}/cfdi/${unlinking!.id}`, { method: "DELETE", body: { reason: c } }); await onChange(); }} />
    </section>
  );
}
