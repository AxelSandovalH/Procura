"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Lock, Play, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeliveriesCard } from "@/components/app/deliveries-card";
import { CollaborationPanel } from "@/components/app/collaboration-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money, qty } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/ui/status";

interface OLine { id: string; line_number: number; name: string; quantity: string; unit_label: string; unit_price_minor: number | string; line_total_minor: number | string; delivered_quantity: string; received_quantity: string; accepted_quantity: string }
interface Order {
  id: string; order_number: string; status: string; perspective: "BUYER" | "SUPPLIER"; requisition_id?: string; currency: string;
  buyer: { display_name: string }; supplier: { display_name: string }; my_reference: string | null; counterpart_reference: string | null;
  subtotal_minor: number | string; tax_minor: number | string; total_minor: number | string; payment_terms: string | null; delivery_terms: string | null; required_date: string | null;
  lines: OLine[]; cancel_reason: string | null; rejected_reason: string | null; created_at: string; confirmed_at: string | null; started_at: string | null; available_actions: string[];
}
type Dlg = "reject" | "cancel" | "close_short" | null;

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");

  const order = useQuery({ queryKey: ["order", id], queryFn: () => api<Order>(`/orders/${id}`) });
  const o = order.data;
  useEffect(() => { if (o) setRef(o.my_reference ?? ""); }, [o?.id, o?.my_reference]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => Promise.all(["order", "orders", "requisition", "req-quotations"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  if (order.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!o) return <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Orden no encontrada</p><Link href="/ordenes" className="mt-2 inline-block text-sm underline">Volver</Link></div>;

  const has = (a: string) => o.available_actions.includes(a);
  const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
  const isBuyer = o.perspective === "BUYER";
  async function simple(path: string) {
    setBusy(true); setError(null);
    try { await api(`/orders/${id}/${path}`, { method: "POST", body: {} }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }
  async function saveRef() {
    if ((ref.trim() || null) === o!.my_reference) return;
    try { await api(`/orders/${id}/reference`, { method: "PATCH", body: { reference: ref.trim() || null } }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo guardar la referencia."); }
  }
  const reason = (path: string) => async (c: string) => { await api(`/orders/${id}/${path}`, { method: "POST", body: { reason: c } }); await refresh(); };

  return (
    <>
      <Link href="/ordenes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Órdenes</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2"><span className="font-mono text-sm text-muted-foreground">{o.order_number}</span><StatusBadge {...st} /><span className="text-xs text-muted-foreground">{isBuyer ? "Compra" : "Venta"}</span></div>
          <h1 className="text-2xl font-semibold tracking-tight">{isBuyer ? `Orden con ${o.supplier.display_name}` : `Orden de ${o.buyer.display_name}`}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {has("confirm") && <Button onClick={() => simple("confirm")} disabled={busy}><Check />Confirmar</Button>}
          {has("start") && <Button onClick={() => simple("start")} disabled={busy}><Play />Iniciar</Button>}
          {has("reject") && <Button variant="destructive" onClick={() => setDlg("reject")}><X />Rechazar</Button>}
          {has("close_short") && <Button variant="outline" onClick={() => setDlg("close_short")}><Lock />Cerrar con faltante</Button>}
          {has("cancel") && <Button variant="destructive" onClick={() => setDlg("cancel")}><XCircle />Cancelar</Button>}
          {isBuyer && o.requisition_id && <Link href={`/requisiciones/${o.requisition_id}`} className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm hover:bg-muted">Ver requisición</Link>}
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {(o.cancel_reason || o.rejected_reason) && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">{o.rejected_reason ? `Motivo de rechazo: ${o.rejected_reason}` : `Motivo de cancelación: ${o.cancel_reason}`}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Líneas</CardTitle></CardHeader>
          <CardContent className="px-0"><div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">P. unitario</TableHead><TableHead className="text-right">Entregado</TableHead><TableHead className="text-right">Recibido</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
            <TableBody>{o.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell className="text-right tabular-nums">{qty(l.quantity)} {l.unit_label}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.unit_price_minor, o.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{qty(l.delivered_quantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{qty(l.received_quantity)}{Number(l.accepted_quantity) !== Number(l.received_quantity) && <span className="block text-xs text-muted-foreground">aceptado {qty(l.accepted_quantity)}</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.line_total_minor, o.currency)}</TableCell>
              </TableRow>))}</TableBody>
          </Table></div>
          <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 px-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(o.subtotal_minor, o.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Impuestos</dt><dd className="tabular-nums">{money(o.tax_minor, o.currency)}</dd></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(o.total_minor, o.currency)}</dd></div>
          </dl></CardContent>
        </Card>
        {["CONFIRMED", "IN_PROCESS", "COMPLETED", "CANCELLED"].includes(o.status) && <DeliveriesCard orderId={o.id} perspective={o.perspective} orderStatus={o.status} lines={o.lines} availableActions={o.available_actions} />}
        <CollaborationPanel anchorType="ORDER" anchorId={o.id} counterpartName={isBuyer ? o.supplier.display_name : o.buyer.display_name} />
        </div>

        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Detalles</CardTitle></CardHeader><CardContent><dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Comprador</dt><dd>{o.buyer.display_name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Proveedor</dt><dd>{o.supplier.display_name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fecha requerida</dt><dd>{dateShort(o.required_date)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Creada</dt><dd>{dateShort(o.created_at)}</dd></div>
            {o.confirmed_at && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Confirmada</dt><dd>{dateShort(o.confirmed_at)}</dd></div>}
            {o.payment_terms && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Pago</dt><dd className="text-right">{o.payment_terms}</dd></div>}
            {o.delivery_terms && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Entrega</dt><dd className="text-right">{o.delivery_terms}</dd></div>}
          </dl></CardContent></Card>
          <Card><CardHeader><CardTitle>Referencias</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <div className="space-y-1.5"><label htmlFor="myref" className="text-muted-foreground">{isBuyer ? "Tu número de PO" : "Tu número de venta"}</label><Input id="myref" value={ref} onChange={(e) => setRef(e.target.value)} onBlur={saveRef} placeholder="Opcional" maxLength={80} /></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">{isBuyer ? "Referencia del proveedor" : "Referencia del cliente"}</span><span>{o.counterpart_reference ?? "—"}</span></div>
          </CardContent></Card>
        </div>
      </div>

      <ActionDialog open={dlg === "reject"} onOpenChange={(v) => !v && setDlg(null)} title="Rechazar orden" description="El comprador verá tu motivo y podrá reabrir la requisición." fieldLabel="Motivo" required destructive confirmLabel="Rechazar" onConfirm={reason("reject")} />
      <ActionDialog open={dlg === "cancel"} onOpenChange={(v) => !v && setDlg(null)} title="Cancelar orden" description="La otra parte será notificada." fieldLabel="Motivo" required destructive confirmLabel="Cancelar orden" onConfirm={reason("cancel")} />
      <ActionDialog open={dlg === "close_short"} onOpenChange={(v) => !v && setDlg(null)} title="Cerrar con faltante" description="Da la orden por completada con lo entregado hasta ahora." fieldLabel="Motivo" required confirmLabel="Cerrar orden" onConfirm={reason("close-short")} />
    </>
  );
}
