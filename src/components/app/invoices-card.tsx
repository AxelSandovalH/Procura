"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/ui/status";

interface Disc { code: string; severity: "ERROR" | "WARN"; message: string }
interface Invoice {
  id: string; fiscal_uuid: string; series: string | null; folio: string | null; issued_at: string | null; issuer_name: string | null; issuer_rfc: string;
  currency: string; subtotal_minor: number | string; tax_minor: number | string; total_minor: number | string; status: string; discrepancies: Disc[];
  review_reason: string | null; has_pdf: boolean; created_at: string;
}
interface Resp { data: Invoice[]; perspective: "BUYER" | "SUPPLIER"; summary: { currency: string; order_total_minor: number | string; invoiced_total_minor: number | string; pending_to_invoice_minor: number | string; received_subtotal_minor: number | string | null } }

const INVOICEABLE = ["CONFIRMED", "IN_PROCESS", "COMPLETED"];

/** Facturas (CFDI) de una orden: el proveedor adjunta; el comprador ve el cotejo contra la orden y la recepción y decide. */
export function InvoicesCard({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const session = useSession();
  const qc = useQueryClient();
  const [upload, setUpload] = useState(false);
  const [dlg, setDlg] = useState<{ kind: "accept" | "reject"; inv: Invoice } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["order-invoices", orderId], queryFn: () => api<Resp>(`/orders/${orderId}/invoices`), enabled: session.can("invoice.read") });
  const refresh = () => Promise.all(["order-invoices", "invoices"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (!session.can("invoice.read") || !q.data) return null;
  const { data: list, summary, perspective } = q.data;
  const canUpload = perspective === "SUPPLIER" && session.can("invoice.submit") && INVOICEABLE.includes(orderStatus);
  const canReview = perspective === "BUYER" && session.can("invoice.review");
  if (list.length === 0 && !canUpload) return null;

  async function download(id: string, kind: "xml" | "pdf") {
    setError(null);
    try { const d = await api<{ downloads: { xml_url: string | null; pdf_url: string | null } }>(`/invoices/${id}`); const url = kind === "xml" ? d.downloads.xml_url : d.downloads.pdf_url; if (url) window.open(url, "_blank", "noopener"); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo descargar."); }
  }

  return (
    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Facturas</CardTitle>
        {canUpload && <Button size="sm" variant="outline" onClick={() => setUpload(true)}><Upload />Adjuntar factura</Button>}</div></CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Total de la orden</dt><dd className="tabular-nums">{money(summary.order_total_minor, summary.currency)}</dd></div>
          <div><dt className="text-muted-foreground">Facturado</dt><dd className="tabular-nums">{money(summary.invoiced_total_minor, summary.currency)}</dd></div>
          <div><dt className="text-muted-foreground">Por facturar</dt><dd className="tabular-nums">{money(summary.pending_to_invoice_minor, summary.currency)}</dd></div>
          <div><dt className="text-muted-foreground">Recibido (subtotal)</dt><dd className="tabular-nums">{summary.received_subtotal_minor == null ? "—" : money(summary.received_subtotal_minor, summary.currency)}</dd></div>
        </dl>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay facturas adjuntas.</p> : (
          <ul className="space-y-3">{list.map((i) => {
            const st = INVOICE_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
            const issues = i.discrepancies.filter((d) => d.severity === "ERROR"); const notes = i.discrepancies.filter((d) => d.severity === "WARN");
            return (
              <li key={i.id} className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><FileText className="size-4 text-muted-foreground" aria-hidden /><span className="font-medium">{[i.series, i.folio].filter(Boolean).join("-") || "Sin folio"}</span><StatusBadge {...st} /></div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={i.fiscal_uuid}>UUID {i.fiscal_uuid} · {i.issuer_name ?? i.issuer_rfc} · {dateShort(i.issued_at ?? i.created_at)}</p></div>
                  <div className="shrink-0 text-right tabular-nums"><div className="font-semibold">{money(i.total_minor, i.currency)}</div><div className="text-xs text-muted-foreground">Subtotal {money(i.subtotal_minor, i.currency)} · IVA {money(i.tax_minor, i.currency)}</div></div>
                </div>
                {issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">{issues.map((d) => <li key={d.code}>{d.message}</li>)}</ul>}
                {notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{notes.map((d) => <li key={d.code}>{d.message}</li>)}</ul>}
                {i.review_reason && <p className="text-xs text-muted-foreground">Motivo: “{i.review_reason}”</p>}
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => void download(i.id, "xml")}><Download />XML</Button>
                  {i.has_pdf && <Button size="sm" variant="ghost" onClick={() => void download(i.id, "pdf")}><Download />PDF</Button>}
                  {canReview && i.status === "DISCREPANCY" && <Button size="sm" onClick={() => setDlg({ kind: "accept", inv: i })}><Check />Aceptar con diferencia</Button>}
                  {canReview && i.status !== "REJECTED" && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "reject", inv: i })}><X />Rechazar</Button>}
                </div>
              </li>);
          })}</ul>)}
      </CardContent>

      <UploadDialog open={upload} onOpenChange={setUpload} orderId={orderId} onDone={refresh} />
      <ActionDialog open={dlg?.kind === "accept"} onOpenChange={(o) => !o && setDlg(null)} title="Aceptar factura con diferencias" description="Quedará registrada tu decisión y la factura contará como facturado." fieldLabel="Motivo (opcional)" confirmLabel="Aceptar"
        onConfirm={async (c) => { await api(`/invoices/${dlg!.inv.id}/accept`, { method: "POST", body: { reason: c || undefined } }); await refresh(); }} />
      <ActionDialog open={dlg?.kind === "reject"} onOpenChange={(o) => !o && setDlg(null)} title="Rechazar factura" description="El proveedor recibirá tu motivo y podrá adjuntar una corregida." fieldLabel="Motivo" required destructive confirmLabel="Rechazar"
        onConfirm={async (c) => { await api(`/invoices/${dlg!.inv.id}/reject`, { method: "POST", body: { reason: c } }); await refresh(); }} />
    </Card>
  );
}

function UploadDialog({ open, onOpenChange, orderId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; orderId: string; onDone: () => Promise<unknown> }) {
  const xml = useRef<HTMLInputElement>(null); const pdf = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);

  async function go() {
    const x = xml.current?.files?.[0]; if (!x) { setError("Selecciona el XML del CFDI."); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      const fd = new FormData(); fd.append("xml", x); const p = pdf.current?.files?.[0]; if (p) fd.append("pdf", p);
      const res = await fetch(`/api/v1/orders/${orderId}/invoices`, { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.title ?? "Error", data?.detail);
      await onDone();
      if (data?.invoice?.status === "DISCREPANCY") { setInfo("Factura registrada, pero tiene diferencias contra la orden o la recepción. El comprador la revisará."); }
      else onOpenChange(false);
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo adjuntar la factura."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setError(null); setInfo(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Adjuntar factura</DialogTitle><DialogDescription>Sube el XML del CFDI timbrado (obligatorio) y, si quieres, el PDF. Leemos el XML para validar RFC, total y folio fiscal.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="inv-xml">XML del CFDI *</Label><input id="inv-xml" ref={xml} type="file" accept=".xml,text/xml,application/xml" className="block w-full text-sm" /></div>
          <div className="space-y-1.5"><Label htmlFor="inv-pdf">PDF (opcional)</Label><input id="inv-pdf" ref={pdf} type="file" accept=".pdf,application/pdf" className="block w-full text-sm" /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {info && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{info}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{info ? "Cerrar" : "Cancelar"}</Button>{!info && <Button onClick={() => void go()} disabled={busy}>{busy ? "Validando…" : "Adjuntar"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
