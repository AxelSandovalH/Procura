"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { Files } from "@/components/app/collaboration-panel";
import { ChangeCustomer } from "@/components/app/change-customer";
import { IssueInvoiceButton } from "@/components/app/issue-invoice";
import { CfdiSection, PaymentsSection, apiErr, type CfdiLinkRow, type PaymentRow } from "@/components/app/finance-sections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { dateShort, money, qty } from "@/lib/format";
import { COLLECTION_STATUS, INVOICING_STATUS, PAYMENT_METHOD } from "@/lib/ui/status";

interface SaleDetail {
  id: string; folio: string; sold_at: string; description: string; currency: string; subtotal_minor: number | string; discount_minor: number | string; tax_minor: number | string; total_minor: number | string;
  payment_method: string | null; notes: string | null; voided_at: string | null; void_reason: string | null; invoicing_flag: string | null; customer: { id: string; name: string; tax_id: string | null; tax_regime_code: string | null; zip_code: string | null; cfdi_use_code: string | null; email: string | null } | null;
  withheld_minor?: number | string; fiscal_issue: { status: string; error: string | null; provider_invoice_id: string | null } | null;
  collection_status: string; invoicing_status: string; pending_to_collect_minor: number | string; documented_minor: number | string; pending_to_document_minor: number | string; difference_minor: number | string | null;
  lines: { id: string; line_number: number; sat_product_code?: string | null; sat_unit_code?: string | null; description: string; quantity: string; unit_price_minor: number | string; discount_minor: number | string; tax_rate: string; tax_minor: number | string; total_minor: number | string }[];
  payments: PaymentRow[]; cfdi: CfdiLinkRow[];
}

export default function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession(); const qc = useQueryClient();
  const [voiding, setVoiding] = useState(false); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["sale", id], queryFn: () => api<SaleDetail>(`/sales/${id}`) });
  const refresh = () => Promise.all(["sale", "sales", "cfdi", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const s = q.data;
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!s) return <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Venta no encontrada</p><Link href="/ventas" className="mt-2 inline-block text-sm underline">Volver a ventas</Link></div>;
  async function flag(f: "PENDING" | "INCIDENT" | null) { setError(null); try { await api(`/sales/${id}/invoicing-flag`, { body: { flag: f } }); await refresh(); } catch (e) { setError(apiErr(e, "No se pudo actualizar.")); } }
  const manage = can("sale.manage") && !s.voided_at;
  const mismatch = s.cfdi.length > 0 && Number(s.documented_minor) !== Number(s.total_minor);

  return (
    <>
      <Link href="/ventas" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Ventas</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm text-muted-foreground">{s.folio}</span>
            <StatusBadge {...(COLLECTION_STATUS[s.collection_status] ?? { label: s.collection_status, tone: "neutral" as const })} /><StatusBadge {...(INVOICING_STATUS[s.invoicing_status] ?? { label: s.invoicing_status, tone: "neutral" as const })} /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{s.description}</h1>
          <p className="text-sm text-muted-foreground">{dateShort(s.sold_at)}{s.customer ? ` · ${s.customer.name}` : ""}{s.payment_method ? ` · ${PAYMENT_METHOD[s.payment_method] ?? s.payment_method}` : ""}{manage && <> · <ChangeCustomer saleId={s.id} current={s.customer} locked={s.cfdi.length > 0} onDone={refresh} /></>}</p>
        </div>
        {manage && <div className="flex flex-wrap items-center gap-2">
          <IssueInvoiceButton sale={s} onDone={refresh} />
          {s.invoicing_flag !== "PENDING" && s.invoicing_status === "NONE" && <Button variant="outline" onClick={() => void flag("PENDING")}>Marcar facturación pendiente</Button>}
          {s.invoicing_flag === "PENDING" && <Button variant="outline" onClick={() => void flag(null)}>Quitar «facturación pendiente»</Button>}
          {s.invoicing_flag !== "INCIDENT" ? <Button variant="outline" onClick={() => void flag("INCIDENT")}><AlertTriangle />Reportar incidencia</Button> : <Button variant="outline" onClick={() => void flag(null)}>Resolver incidencia</Button>}
          <Button variant="destructive" onClick={() => setVoiding(true)}><Ban />Anular</Button></div>}
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {s.voided_at && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">Venta anulada: {s.void_reason}</p>}
      {mismatch && <p role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />Lo documentado con CFDI ({money(s.documented_minor, s.currency)}) no coincide con el total de la venta ({money(s.total_minor, s.currency)}).</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card><CardHeader><CardTitle>Conceptos</CardTitle></CardHeader><CardContent className="px-0">
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead className="text-right">Cant.</TableHead><TableHead className="text-right">P. unitario</TableHead><TableHead className="text-right">Desc.</TableHead><TableHead className="text-right">IVA</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
              <TableBody>{s.lines.map((l) => (
                <TableRow key={l.id}><TableCell className="font-medium">{l.description}</TableCell><TableCell className="text-right tabular-nums">{qty(l.quantity)}</TableCell><TableCell className="text-right tabular-nums">{money(l.unit_price_minor, s.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(l.discount_minor) ? money(l.discount_minor, s.currency) : "—"}</TableCell><TableCell className="text-right tabular-nums">{money(l.tax_minor, s.currency)} <span className="text-xs text-muted-foreground">({Math.round(Number(l.tax_rate) * 100)}%)</span></TableCell><TableCell className="text-right tabular-nums">{money(l.total_minor, s.currency)}</TableCell></TableRow>))}</TableBody>
            </Table></div>
            <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 px-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(s.subtotal_minor, s.currency)}</dd></div>
              {Number(s.discount_minor) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Descuentos</dt><dd className="tabular-nums">−{money(s.discount_minor, s.currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Impuestos</dt><dd className="tabular-nums">{money(s.tax_minor, s.currency)}</dd></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(s.total_minor, s.currency)}</dd></div>
              {Number(s.withheld_minor ?? 0) > 0 && <>
                <div className="flex justify-between"><dt className="text-muted-foreground">− Retenido por el cliente (ISR e IVA)</dt><dd className="tabular-nums">{money(s.withheld_minor, s.currency)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Neto que recibes</dt><dd className="tabular-nums">{money(Number(s.total_minor) - Number(s.withheld_minor), s.currency)}</dd></div></>}
            </dl>
            {s.notes && <p className="mt-3 px-4 text-sm text-muted-foreground">Notas: {s.notes}</p>}
          </CardContent></Card>
          <Card><CardContent className="pt-4"><CfdiSection base={`/sales/${s.id}`} links={s.cfdi} currency={s.currency} totalMinor={s.total_minor} documentedMinor={s.documented_minor} direction="ISSUED" voided={!!s.voided_at} onChange={refresh} /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Comprobantes</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-xs text-muted-foreground">Tickets de depósito, recibos o cualquier soporte de esta venta y de sus cobros.</p><Files anchorType="SALE" anchorId={s.id} canShare={false} /></CardContent></Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card><CardHeader><CardTitle>Resumen</CardTitle></CardHeader><CardContent><dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Total</dt><dd className="tabular-nums">{money(s.total_minor, s.currency)}</dd></div>
            {Number(s.withheld_minor ?? 0) > 0 && <>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Retenido por el cliente</dt><dd className="tabular-nums">−{money(s.withheld_minor, s.currency)}</dd></div>
              <div className="flex justify-between gap-3 font-medium"><dt>Neto que recibes</dt><dd className="tabular-nums">{money(Number(s.total_minor) - Number(s.withheld_minor), s.currency)}</dd></div></>}
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Pendiente de cobro</dt><dd className="tabular-nums">{money(s.pending_to_collect_minor, s.currency)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Documentado (CFDI)</dt><dd className="tabular-nums">{money(s.documented_minor, s.currency)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Por documentar</dt><dd className="tabular-nums">{money(s.pending_to_document_minor, s.currency)}</dd></div>
          </dl><p className="mt-3 text-xs text-muted-foreground">Cobro y facturación son independientes: una factura emitida no significa que el cliente haya pagado.</p></CardContent></Card>
          <Card><CardContent className="pt-4"><PaymentsSection base={`/sales/${s.id}`} payments={s.payments} currency={s.currency} pendingMinor={s.pending_to_collect_minor} voided={!!s.voided_at} kind="sale" onChange={refresh} /></CardContent></Card>
        </div>
      </div>
      <ActionDialog open={voiding} onOpenChange={setVoiding} title="Anular venta" description="No se borra: queda anulada con tu motivo. Antes hay que anular sus cobros y desligar sus CFDI." fieldLabel="Motivo" required destructive confirmLabel="Anular"
        onConfirm={async (c) => { await api(`/sales/${s.id}/void`, { body: { reason: c } }); await refresh(); }} />
    </>
  );
}
