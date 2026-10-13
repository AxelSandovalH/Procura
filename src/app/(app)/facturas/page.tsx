"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Info, Receipt, Search, Upload } from "lucide-react";
import { SatDownloadCard } from "@/components/app/sat-download";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { apiErr } from "@/components/app/finance-sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";
import { SAT_STATUS } from "@/lib/ui/status";
import Link from "next/link";

interface Cfdi { id: string; direction: "ISSUED" | "RECEIVED"; fiscal_uuid: string; series: string | null; folio: string | null; issued_at: string | null; issuer_name: string | null; issuer_rfc: string; receiver_name: string | null; receiver_rfc: string; currency: string; total_minor: number | string; allocated_minor: number | string; pending_to_allocate_minor: number | string; sat_status: string; cfdi_type: string; source: string; has_pdf: boolean; fiscal_payment_method: string | null }
interface Detail extends Cfdi { provider?: string | null; provider_external_id?: string | null; cancel_reason_code?: string | null; cancel_replacement_uuid?: string | null; cancel_requested_at?: string | null; cancelled_at?: string | null; downloads: { xml_url: string | null; pdf_url: string | null }; links: { id: string; amount_minor: number | string; sale: { id: string; folio: string; description: string } | null; expense: { id: string; description: string } | null }[] }
interface Provider { provider: string; configured: boolean; capabilities: Record<string, boolean>; notes: string[] }
const TYPE: Record<string, string> = { I: "Ingreso", E: "Egreso", P: "Pago", T: "Traslado", N: "Nómina" };
const SOURCE: Record<string, string> = { MANUAL_UPLOAD: "Carga manual", SUPPLIER_ORDER: "Factura de proveedor en una orden", PROVIDER_SYNC: "Sincronización", PROVIDER_ISSUED: "Emitida desde Procura" };
/** El «tipo» del SAT describe el comprobante para quien lo emite: una factura que te hacen a ti es «Ingreso» para el emisor, pero para ti es una compra. */
const typeName = (direction: string, t: string) => (t === "I" ? (direction === "RECEIVED" ? "Factura recibida" : "Factura emitida") : t === "E" ? "Nota de crédito" : t === "P" ? "Complemento de pago" : TYPE[t] ?? t);
const label = (c: { series: string | null; folio: string | null; fiscal_uuid: string }) => [c.series, c.folio].filter(Boolean).join("-") || c.fiscal_uuid.slice(0, 8);

export default function FacturasPage() {
  const session = useSession(); const qc = useQueryClient();
  const [tab, setTab] = useState<"ISSUED" | "RECEIVED">("RECEIVED");
  const [f, setF] = useState({ q: "", from: "", to: "", unlinked: false });
  const [upload, setUpload] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [making, setMaking] = useState(false); const [single, setSingle] = useState<string | null>(null);
  const qs = new URLSearchParams({ direction: tab, ...(f.q ? { q: f.q } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.unlinked ? { unlinked: "1" } : {}) }).toString();
  const list = useQuery({ queryKey: ["cfdi", "list", qs], queryFn: () => api<{ data: Cfdi[] }>(`/cfdi?${qs}`), enabled: session.can("cfdi.read") });
  const provider = useQuery({ queryKey: ["fiscal-provider"], queryFn: () => api<Provider>("/fiscal/provider"), enabled: session.can("cfdi.read"), staleTime: 60_000 });
  const refresh = () => Promise.all(["cfdi", "sale", "sales", "expenses", "expense"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (!session.can("cfdi.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver comprobantes fiscales.</p>;
  const rows = list.data?.data ?? [];
  const selectable = tab === "RECEIVED" ? rows.filter((c) => c.cfdi_type === "I" && Number(c.allocated_minor) === 0 && c.sat_status !== "CANCELADO") : [];
  const chosen = [...picked].filter((id) => selectable.some((c) => c.id === id));
  const togglePick = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tabs: [typeof tab, string][] = [["RECEIVED", "Recibidas"], ["ISSUED", "Emitidas"]];

  return (
    <>
      <PageHeader title="Facturas" description="Comprobantes fiscales (CFDI) emitidos y recibidos. Ligarlos a ventas y gastos documenta tus operaciones."
        actions={session.can("cfdi.manage") ? <Button onClick={() => setUpload(true)}><Upload />Cargar CFDI</Button> : undefined} />
      <SatDownloadCard onImported={refresh} />
      {provider.data && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div><span className="font-medium">Proveedor fiscal: {provider.data.configured ? "credenciales presentes" : "sin configurar"}.</span> La emisión de CFDI y la sincronización automática con el SAT o un proveedor aún no están disponibles; por ahora se cargan los XML manualmente y los que adjuntan tus proveedores a sus órdenes aparecen solos.</div></div>)}
      <div className="mb-3 flex gap-1 rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="Dirección del comprobante">
        {tabs.map(([k, name]) => <button key={k} role="tab" aria-selected={tab === k} className={`flex-1 rounded-md px-3 py-1.5 font-medium sm:flex-none ${tab === k ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setTab(k)}>{name}</button>)}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Buscar" className="pl-8" placeholder="UUID, folio, nombre o RFC" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <Input aria-label="Desde" type="date" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input aria-label="Hasta" type="date" className="w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        {chosen.length > 0 && session.can("expense.manage") && <Button variant="outline" onClick={() => setMaking(true)}>Crear gasto{chosen.length > 1 ? `s (${chosen.length})` : ""} de la selección</Button>}
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.unlinked} onChange={(e) => setF({ ...f, unlinked: e.target.checked })} />Solo sin ligar</label>
      </div>
      {list.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><FileText className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Sin comprobantes {tab === "ISSUED" ? "emitidos" : "recibidos"}</p><p className="mt-1 text-sm text-muted-foreground">Carga el XML del CFDI para registrarlo.</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow>{tab === "RECEIVED" && <TableHead className="w-8"><input type="checkbox" aria-label="Seleccionar todas las facturas sin gasto" checked={selectable.length > 0 && chosen.length === selectable.length} onChange={(e) => setPicked(e.target.checked ? new Set(selectable.map((c) => c.id)) : new Set())} /></TableHead>}<TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>{tab === "ISSUED" ? "Receptor" : "Emisor"}</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Sin ligar</TableHead><TableHead>Vigencia</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((c) => (
            <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
              {tab === "RECEIVED" && <TableCell onClick={(e) => e.stopPropagation()}>{selectable.some((x) => x.id === c.id) ? <input type="checkbox" aria-label={`Seleccionar ${label(c)}`} checked={picked.has(c.id)} onChange={() => togglePick(c.id)} /> : null}</TableCell>}
              <TableCell className="font-medium"><button className="text-left hover:underline" onClick={() => setOpenId(c.id)}>{label(c)}</button><div className="max-w-40 truncate font-mono text-xs text-muted-foreground" title={c.fiscal_uuid}>{c.fiscal_uuid}</div></TableCell>
              <TableCell>{dateShort(c.issued_at)}</TableCell>
              <TableCell>{tab === "ISSUED" ? c.receiver_name ?? c.receiver_rfc : c.issuer_name ?? c.issuer_rfc}</TableCell><TableCell className="text-muted-foreground">{typeName(c.direction, c.cfdi_type)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(c.total_minor, c.currency)}</TableCell><TableCell className="text-right tabular-nums">{c.cfdi_type === "I" ? money(c.pending_to_allocate_minor, c.currency) : "—"}</TableCell>
              <TableCell><StatusBadge {...(SAT_STATUS[c.sat_status] ?? { label: c.sat_status, tone: "neutral" as const })} /></TableCell>
            </TableRow>))}</TableBody>
        </Table></div>)}
      <ExpensesFromCfdi ids={chosen} open={making} onOpenChange={setMaking} onDone={async () => { setPicked(new Set()); await refresh(); }} />
      <UploadCfdi open={upload} onOpenChange={setUpload} defaultDirection={tab} onDone={refresh} />
      <CfdiDetail id={openId} onClose={() => setOpenId(null)} canCreateExpense={session.can("expense.manage") && session.can("cfdi.manage")} onCreateExpense={(cid) => { setOpenId(null); setSingle(cid); }} canCancel={session.can("cfdi.manage")} onChanged={refresh} />
      <ExpensesFromCfdi ids={single ? [single] : []} open={!!single} onOpenChange={(o) => !o && setSingle(null)} onDone={refresh} />
    </>
  );
}

interface BulkResult { file: string; status: "CREATED" | "DUPLICATE" | "ERROR" | "IGNORED"; message?: string; fiscal_uuid?: string; direction?: string }
const STATUS_TEXT: Record<BulkResult["status"], { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = { CREATED: { label: "Cargado", tone: "ok" }, DUPLICATE: { label: "Ya existía", tone: "warn" }, ERROR: { label: "Error", tone: "bad" }, IGNORED: { label: "Ignorado", tone: "muted" } };

/** Carga masiva: varios XML (con sus PDF del mismo nombre) o un ZIP. Cada archivo se procesa por separado. */
function UploadCfdi({ open, onOpenChange, defaultDirection, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; defaultDirection: "ISSUED" | "RECEIVED"; onDone: () => Promise<unknown> }) {
  const input = useRef<HTMLInputElement>(null);
  const [dir, setDir] = useState<"" | "ISSUED" | "RECEIVED">(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ summary: { created: number; duplicates: number; errors: number; ignored: number }; results: BulkResult[] } | null>(null);
  async function go() {
    const files = Array.from(input.current?.files ?? []); if (files.length === 0) { setError("Selecciona uno o más archivos XML (y sus PDF) o un ZIP."); return; }
    setBusy(true); setError(null); setOut(null);
    try {
      const fd = new FormData(); for (const f of files) fd.append("files", f); if (dir) fd.append("direction", dir);
      const res = await fetch("/api/v1/cfdi/bulk", { method: "POST", body: fd, credentials: "same-origin" }); const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.title ?? "Error", data?.detail);
      setOut(data); await onDone();
    } catch (e) { setError(apiErr(e, "No se pudieron cargar los archivos.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setError(null); setOut(null); } }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Cargar CFDI</DialogTitle><DialogDescription>Sube varios XML a la vez, o un ZIP con ellos. Si incluyes el PDF con el mismo nombre que el XML, se guarda junto. El folio fiscal no se puede repetir.</DialogDescription></DialogHeader>
      {!out ? (
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="c-files">Archivos (.xml, .pdf o .zip) *</Label><input id="c-files" ref={input} type="file" multiple accept=".xml,.pdf,.zip,text/xml,application/xml,application/pdf,application/zip" className="block w-full text-sm" /></div>
          <div className="space-y-1.5"><Label htmlFor="c-dir">Tipo de comprobante</Label>
            <select id="c-dir" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
              <option value="">Detectar por el RFC de mi organización</option><option value="RECEIVED">Recibidos (me los emitieron)</option><option value="ISSUED">Emitidos (los emití yo)</option></select>
            <p className="text-xs text-muted-foreground">Con tu RFC registrado se deduce solo para cada comprobante. Pestaña actual: {defaultDirection === "ISSUED" ? "emitidas" : "recibidas"}.</p></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p role="status" className="font-medium">{out.summary.created} cargado{out.summary.created === 1 ? "" : "s"} · {out.summary.duplicates} ya existían · {out.summary.errors} con error{out.summary.ignored ? ` · ${out.summary.ignored} ignorados` : ""}</p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">{out.results.map((r, i) => (
            <li key={i} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2"><span className="min-w-0"><span className="block truncate font-medium">{r.file}</span>{r.message && <span className="block text-xs text-muted-foreground">{r.message}</span>}</span><StatusBadge label={STATUS_TEXT[r.status].label} tone={STATUS_TEXT[r.status].tone} /></li>))}</ul>
        </div>)}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{out ? "Cerrar" : "Cancelar"}</Button>{!out && <Button onClick={() => void go()} disabled={busy}>{busy ? "Leyendo…" : "Cargar"}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  );
}

/** Crea un gasto por cada CFDI recibido seleccionado, ya ligado a su comprobante. */
function ExpensesFromCfdi({ ids, open, onOpenChange, onDone }: { ids: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [category, setCategory] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ summary: { created: number; skipped: number; errors: number }; results: { cfdi_id: string; status: string; message?: string }[] } | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try { setOut(await api("/cfdi/expenses", { body: { cfdi_ids: ids, category: category.trim() || undefined } })); await onDone(); }
    catch (e) { setError(apiErr(e, "No se pudieron crear los gastos.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setOut(null); setError(null); } }}><DialogContent>
      <DialogHeader><DialogTitle>Crear gastos desde {ids.length} factura{ids.length === 1 ? "" : "s"}</DialogTitle><DialogDescription>Se crea un gasto por cada una (fecha, monto y emisor del CFDI) ya ligado a su comprobante. No se duplican las que ya tienen gasto.</DialogDescription></DialogHeader>
      {!out ? (
        <div className="space-y-3"><div className="space-y-1.5"><Label htmlFor="e-cat">Categoría (opcional, para todas)</Label><Input id="e-cat" maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Insumos, servicios…" /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>
      ) : (
        <div className="space-y-2 text-sm"><p role="status" className="font-medium">{out.summary.created} gasto{out.summary.created === 1 ? "" : "s"} creado{out.summary.created === 1 ? "" : "s"} · {out.summary.skipped} omitido{out.summary.skipped === 1 ? "" : "s"} · {out.summary.errors} con error</p>
          {out.results.filter((r) => r.status !== "CREATED").map((r) => <p key={r.cfdi_id} className="text-xs text-muted-foreground">{r.status === "SKIPPED" ? "Omitido" : "Error"}: {r.message}</p>)}
          <Link href="/gastos" className="inline-block underline">Ver gastos</Link></div>)}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{out ? "Cerrar" : "Cancelar"}</Button>{!out && <Button onClick={() => void go()} disabled={busy}>{busy ? "Creando…" : "Crear gastos"}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  );
}

function CfdiDetail({ id, onClose, canCreateExpense, onCreateExpense, canCancel, onChanged }: { id: string | null; onClose: () => void; canCreateExpense: boolean; onCreateExpense: (id: string) => void; canCancel: boolean; onChanged: () => Promise<unknown> }) {
  const [cancelling, setCancelling] = useState(false); const [pdfBusy, setPdfBusy] = useState(false); const [checking, setChecking] = useState(false); const [note, setNote] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["cfdi", "detail", id], queryFn: () => api<Detail>(`/cfdi/${id}`), enabled: !!id });
  const c = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}><DialogContent>
      {!c ? <div className="h-32 animate-pulse rounded bg-muted" /> : (<>
        <DialogHeader><DialogTitle>{label(c)} · {typeName(c.direction, c.cfdi_type)}</DialogTitle><DialogDescription className="break-all font-mono text-xs">{c.fiscal_uuid}</DialogDescription></DialogHeader>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Emisor</dt><dd className="text-right">{c.issuer_name ?? "—"} <span className="text-muted-foreground">{c.issuer_rfc}</span></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Receptor</dt><dd className="text-right">{c.receiver_name ?? "—"} <span className="text-muted-foreground">{c.receiver_rfc}</span></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fecha</dt><dd>{dateShort(c.issued_at)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{money(c.total_minor, c.currency)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Ligado a operaciones</dt><dd className="tabular-nums">{money(c.allocated_minor, c.currency)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tipo según el SAT</dt><dd>{TYPE[c.cfdi_type] ?? c.cfdi_type}{c.direction === "RECEIVED" && c.cfdi_type === "I" ? <span className="text-muted-foreground"> (ingreso del emisor)</span> : null}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Origen</dt><dd>{SOURCE[c.source] ?? c.source}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Vigencia ante el SAT</dt><dd><StatusBadge {...(SAT_STATUS[c.sat_status] ?? { label: c.sat_status, tone: "neutral" as const })} /></dd></div>
        </dl>
        <div><p className="mb-1.5 text-sm font-medium">Operaciones que documenta</p>
          {c.links.length === 0 ? <p className="text-sm text-muted-foreground">Aún no está ligado a ninguna venta o gasto.</p> : <ul className="space-y-1 text-sm">{c.links.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 rounded-lg border px-3 py-2"><span>{l.sale ? <Link className="underline" href={`/ventas/${l.sale.id}`}>{l.sale.folio}</Link> : null}{l.sale ? ` · ${l.sale.description}` : ""}{l.expense ? `Gasto · ${l.expense.description}` : ""}</span><span className="tabular-nums">{money(l.amount_minor, c.currency)}</span></li>))}</ul>}
        </div>
        {c.sat_status === "CANCELANDO" && (
          <div role="status" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <p>Cancelación solicitada{c.cancel_requested_at ? ` el ${dateShort(c.cancel_requested_at)}` : ""} (motivo {c.cancel_reason_code}). El SAT la confirma en minutos u horas; si el receptor la rechaza, el CFDI vuelve a quedar vigente.</p>
            {canCancel && <Button size="sm" variant="outline" disabled={checking} onClick={async () => { setChecking(true); setNote(null); try { const r = await api<{ state: string; raw: string }>(`/cfdi/${c.id}/refresh-status`, { body: {} }); setNote(`Estado en el SAT: ${r.raw || r.state}`); await q.refetch(); await onChanged(); } catch (e) { setNote(apiErr(e, "No se pudo consultar el estado.")); } finally { setChecking(false); } }}>{checking ? "Consultando…" : "Actualizar estado"}</Button>}
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </div>)}
        {c.sat_status === "CANCELADO" && c.cancelled_at && <p className="text-sm text-muted-foreground">Cancelado el {dateShort(c.cancelled_at)}{c.cancel_reason_code ? ` (motivo ${c.cancel_reason_code})` : ""}.</p>}
        {note && c.sat_status !== "CANCELANDO" && <p role="alert" className="text-sm text-destructive">{note}</p>}
        <DialogFooter>
          {canCancel && c.direction === "ISSUED" && c.provider_external_id && (c.sat_status === "VIGENTE" || c.sat_status === "UNKNOWN") && <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>Cancelar CFDI</Button>}
          {canCreateExpense && c.direction === "RECEIVED" && c.cfdi_type === "I" && c.sat_status !== "CANCELADO" && Number(c.allocated_minor) === 0 && <Button onClick={() => onCreateExpense(c.id)}><Receipt />Crear gasto</Button>}
          {c.downloads.xml_url && <Button variant="outline" onClick={() => window.open(c.downloads.xml_url!, "_blank", "noopener")}><Download />XML</Button>}
          {!c.downloads.pdf_url && canCancel && c.direction === "ISSUED" && c.provider_external_id && <Button variant="outline" disabled={pdfBusy} onClick={async () => { setPdfBusy(true); setNote(null); try { const r = await api<{ pdf_url: string | null }>(`/cfdi/${c.id}/pdf`, { body: {} }); await q.refetch(); if (r.pdf_url) window.open(r.pdf_url, "_blank", "noopener"); } catch (e) { setNote(apiErr(e, "No se pudo generar el PDF.")); } finally { setPdfBusy(false); } }}><Download />{pdfBusy ? "Generando…" : "Generar PDF"}</Button>}
          {c.downloads.pdf_url && <Button variant="outline" onClick={() => window.open(c.downloads.pdf_url!, "_blank", "noopener")}><Download />PDF</Button>}
          <Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
      </>)}
      {c && <CancelCfdi cfdi={c} open={cancelling} onOpenChange={setCancelling} onDone={async () => { await q.refetch(); await onChanged(); }} />}
    </DialogContent></Dialog>
  );
}

const REASONS = [
  { code: "02", title: "02 · Se emitió con errores, sin sustituirla", text: "Úsalo si la factura tiene un dato mal y no la vas a reemplazar por otra." },
  { code: "01", title: "01 · Se emitió con errores y la sustituyo por otra", text: "Primero emite la factura correcta; después cancela esta indicando cuál la sustituye." },
  { code: "03", title: "03 · No se llevó a cabo la operación", text: "La venta o el servicio no se realizó." },
];
/** Cancelación de un CFDI emitido. Es irreversible y la confirma el SAT; el receptor puede tener que aceptarla. */
function CancelCfdi({ cfdi, open, onOpenChange, onDone }: { cfdi: Detail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [reason, setReason] = useState("02"); const [replacement, setReplacement] = useState(""); const [sure, setSure] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const issued = useQuery({ queryKey: ["cfdi", "list", "issued-for-replacement"], queryFn: () => api<{ data: Cfdi[] }>("/cfdi?direction=ISSUED"), enabled: open && reason === "01" });
  const options = (issued.data?.data ?? []).filter((x) => x.id !== cfdi.id && x.sat_status !== "CANCELADO" && x.sat_status !== "CANCELANDO" && x.cfdi_type === "I");
  async function go() {
    setBusy(true); setError(null);
    try { await api(`/cfdi/${cfdi.id}/cancel`, { body: { reason_code: reason, ...(reason === "01" ? { replacement_uuid: replacement } : {}), confirm: true } }); await onDone(); setSure(false); onOpenChange(false); }
    catch (e) { setError(apiErr(e, "No se pudo solicitar la cancelación.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setError(null); setSure(false); } }}><DialogContent>
      <DialogHeader><DialogTitle>Cancelar CFDI {label(cfdi)}</DialogTitle><DialogDescription className="break-all font-mono text-xs">{cfdi.fiscal_uuid}</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm">
        <fieldset className="space-y-2"><legend className="mb-1 font-medium">Motivo</legend>
          {REASONS.map((r) => <label key={r.code} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5"><input type="radio" name="reason" className="mt-1" checked={reason === r.code} onChange={() => setReason(r.code)} /><span><span className="block font-medium">{r.title}</span><span className="block text-xs text-muted-foreground">{r.text}</span></span></label>)}
        </fieldset>
        {reason === "01" && (
          <div className="space-y-1"><Label htmlFor="c-rep">CFDI que lo sustituye</Label>
            <select id="c-rep" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={replacement} onChange={(e) => setReplacement(e.target.value)}><option value="">Elige la factura nueva…</option>{options.map((o) => <option key={o.id} value={o.fiscal_uuid}>{label(o)} · {o.receiver_name ?? o.receiver_rfc} · {money(o.total_minor, o.currency)}</option>)}</select>
            {issued.isFetched && options.length === 0 && <p className="text-xs text-amber-700">No hay otra factura emitida vigente. Emite primero la correcta.</p>}</div>)}
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">La cancelación no se puede deshacer. No es inmediata: el SAT la confirma en minutos u horas y, según el caso, el receptor tiene que aceptarla; si la rechaza, el CFDI sigue vigente. Mientras tanto aparece como «Cancelando». Cancelar un CFDI emitido en producción es un trámite fiscal real.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sure} onChange={(e) => setSure(e.target.checked)} />Entiendo que es irreversible y quiero solicitar la cancelación de este CFDI.</label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>No cancelar</Button><Button variant="destructive" onClick={() => void go()} disabled={busy || !sure || (reason === "01" && !replacement)}>{busy ? "Solicitando…" : "Solicitar cancelación"}</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

