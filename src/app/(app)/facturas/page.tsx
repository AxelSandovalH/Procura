"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Info, Search, Upload } from "lucide-react";
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
interface Detail extends Cfdi { downloads: { xml_url: string | null; pdf_url: string | null }; links: { id: string; amount_minor: number | string; sale: { id: string; folio: string; description: string } | null; expense: { id: string; description: string } | null }[] }
interface Provider { provider: string; configured: boolean; capabilities: Record<string, boolean>; notes: string[] }
const TYPE: Record<string, string> = { I: "Ingreso", E: "Egreso", P: "Pago", T: "Traslado", N: "Nómina" };
const SOURCE: Record<string, string> = { MANUAL_UPLOAD: "Carga manual", SUPPLIER_ORDER: "Factura de proveedor en una orden", PROVIDER_SYNC: "Sincronización", PROVIDER_ISSUED: "Emitida desde Procura" };
const label = (c: { series: string | null; folio: string | null; fiscal_uuid: string }) => [c.series, c.folio].filter(Boolean).join("-") || c.fiscal_uuid.slice(0, 8);

export default function FacturasPage() {
  const session = useSession(); const qc = useQueryClient();
  const [tab, setTab] = useState<"ISSUED" | "RECEIVED">("RECEIVED");
  const [f, setF] = useState({ q: "", from: "", to: "", unlinked: false });
  const [upload, setUpload] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const qs = new URLSearchParams({ direction: tab, ...(f.q ? { q: f.q } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.unlinked ? { unlinked: "1" } : {}) }).toString();
  const list = useQuery({ queryKey: ["cfdi", "list", qs], queryFn: () => api<{ data: Cfdi[] }>(`/cfdi?${qs}`), enabled: session.can("cfdi.read") });
  const provider = useQuery({ queryKey: ["fiscal-provider"], queryFn: () => api<Provider>("/fiscal/provider"), enabled: session.can("cfdi.read"), staleTime: 60_000 });
  const refresh = () => Promise.all(["cfdi", "sale", "sales", "expenses", "expense"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (!session.can("cfdi.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver comprobantes fiscales.</p>;
  const rows = list.data?.data ?? [];
  const tabs: [typeof tab, string][] = [["RECEIVED", "Recibidas"], ["ISSUED", "Emitidas"]];

  return (
    <>
      <PageHeader title="Facturas" description="Comprobantes fiscales (CFDI) emitidos y recibidos. Ligarlos a ventas y gastos documenta tus operaciones."
        actions={session.can("cfdi.manage") ? <Button onClick={() => setUpload(true)}><Upload />Cargar CFDI</Button> : undefined} />
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
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.unlinked} onChange={(e) => setF({ ...f, unlinked: e.target.checked })} />Solo sin ligar</label>
      </div>
      {list.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><FileText className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Sin comprobantes {tab === "ISSUED" ? "emitidos" : "recibidos"}</p><p className="mt-1 text-sm text-muted-foreground">Carga el XML del CFDI para registrarlo.</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>{tab === "ISSUED" ? "Receptor" : "Emisor"}</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Sin ligar</TableHead><TableHead>Vigencia</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((c) => (
            <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
              <TableCell className="font-medium"><button className="text-left hover:underline" onClick={() => setOpenId(c.id)}>{label(c)}</button><div className="max-w-40 truncate font-mono text-xs text-muted-foreground" title={c.fiscal_uuid}>{c.fiscal_uuid}</div></TableCell>
              <TableCell>{dateShort(c.issued_at)}</TableCell>
              <TableCell>{tab === "ISSUED" ? c.receiver_name ?? c.receiver_rfc : c.issuer_name ?? c.issuer_rfc}</TableCell><TableCell className="text-muted-foreground">{TYPE[c.cfdi_type] ?? c.cfdi_type}</TableCell>
              <TableCell className="text-right tabular-nums">{money(c.total_minor, c.currency)}</TableCell><TableCell className="text-right tabular-nums">{c.cfdi_type === "I" ? money(c.pending_to_allocate_minor, c.currency) : "—"}</TableCell>
              <TableCell><StatusBadge {...(SAT_STATUS[c.sat_status] ?? { label: c.sat_status, tone: "neutral" as const })} /></TableCell>
            </TableRow>))}</TableBody>
        </Table></div>)}
      <UploadCfdi open={upload} onOpenChange={setUpload} defaultDirection={tab} onDone={refresh} />
      <CfdiDetail id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function UploadCfdi({ open, onOpenChange, defaultDirection, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; defaultDirection: "ISSUED" | "RECEIVED"; onDone: () => Promise<unknown> }) {
  const xml = useRef<HTMLInputElement>(null); const pdf = useRef<HTMLInputElement>(null);
  const [dir, setDir] = useState<"" | "ISSUED" | "RECEIVED">(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function go() {
    const x = xml.current?.files?.[0]; if (!x) { setError("Selecciona el XML del CFDI."); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append("xml", x); const p = pdf.current?.files?.[0]; if (p) fd.append("pdf", p); if (dir) fd.append("direction", dir);
      const res = await fetch("/api/v1/cfdi", { method: "POST", body: fd, credentials: "same-origin" }); const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.title ?? "Error", data?.detail);
      await onDone(); onOpenChange(false);
    } catch (e) { setError(apiErr(e, "No se pudo cargar el CFDI.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setError(null); }}><DialogContent>
      <DialogHeader><DialogTitle>Cargar CFDI</DialogTitle><DialogDescription>Sube el XML timbrado (obligatorio) y, si quieres, el PDF. Leemos el XML; el folio fiscal no se puede repetir.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="c-xml">XML *</Label><input id="c-xml" ref={xml} type="file" accept=".xml,text/xml,application/xml" className="block w-full text-sm" /></div>
        <div className="space-y-1.5"><Label htmlFor="c-pdf">PDF (opcional)</Label><input id="c-pdf" ref={pdf} type="file" accept=".pdf,application/pdf" className="block w-full text-sm" /></div>
        <div className="space-y-1.5"><Label htmlFor="c-dir">Tipo de comprobante</Label>
          <select id="c-dir" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
            <option value="">Detectar por el RFC de mi organización</option><option value="RECEIVED">Recibido (me lo emitió un proveedor)</option><option value="ISSUED">Emitido (lo emití yo)</option></select>
          <p className="text-xs text-muted-foreground">Si tu organización tiene RFC registrado, se deduce solo; si no, elige uno. Pestaña actual: {defaultDirection === "ISSUED" ? "emitidas" : "recibidas"}.</p></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button onClick={() => void go()} disabled={busy}>{busy ? "Leyendo…" : "Cargar"}</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function CfdiDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["cfdi", "detail", id], queryFn: () => api<Detail>(`/cfdi/${id}`), enabled: !!id });
  const c = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}><DialogContent>
      {!c ? <div className="h-32 animate-pulse rounded bg-muted" /> : (<>
        <DialogHeader><DialogTitle>{label(c)} · {TYPE[c.cfdi_type] ?? c.cfdi_type}</DialogTitle><DialogDescription className="break-all font-mono text-xs">{c.fiscal_uuid}</DialogDescription></DialogHeader>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Emisor</dt><dd className="text-right">{c.issuer_name ?? "—"} <span className="text-muted-foreground">{c.issuer_rfc}</span></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Receptor</dt><dd className="text-right">{c.receiver_name ?? "—"} <span className="text-muted-foreground">{c.receiver_rfc}</span></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fecha</dt><dd>{dateShort(c.issued_at)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{money(c.total_minor, c.currency)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Ligado a operaciones</dt><dd className="tabular-nums">{money(c.allocated_minor, c.currency)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Origen</dt><dd>{SOURCE[c.source] ?? c.source}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Vigencia ante el SAT</dt><dd><StatusBadge {...(SAT_STATUS[c.sat_status] ?? { label: c.sat_status, tone: "neutral" as const })} /></dd></div>
        </dl>
        <div><p className="mb-1.5 text-sm font-medium">Operaciones que documenta</p>
          {c.links.length === 0 ? <p className="text-sm text-muted-foreground">Aún no está ligado a ninguna venta o gasto.</p> : <ul className="space-y-1 text-sm">{c.links.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 rounded-lg border px-3 py-2"><span>{l.sale ? <Link className="underline" href={`/ventas/${l.sale.id}`}>{l.sale.folio}</Link> : null}{l.sale ? ` · ${l.sale.description}` : ""}{l.expense ? `Gasto · ${l.expense.description}` : ""}</span><span className="tabular-nums">{money(l.amount_minor, c.currency)}</span></li>))}</ul>}
        </div>
        <DialogFooter>
          {c.downloads.xml_url && <Button variant="outline" onClick={() => window.open(c.downloads.xml_url!, "_blank", "noopener")}><Download />XML</Button>}
          {c.downloads.pdf_url && <Button variant="outline" onClick={() => window.open(c.downloads.pdf_url!, "_blank", "noopener")}><Download />PDF</Button>}
          <Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
      </>)}
    </DialogContent></Dialog>
  );
}
