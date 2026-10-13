"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { CfdiSection, PaymentsSection, apiErr, type CfdiLinkRow, type PaymentRow } from "@/components/app/finance-sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { dateShort, money, toMinor } from "@/lib/format";
import { INVOICING_STATUS, PAYMENT_STATUS } from "@/lib/ui/status";

interface Expense { id: string; spent_at: string; description: string; category: string | null; amount_minor: number | string; currency: string; supplier_name: string | null; order_id: string | null; source: string; voided_at: string | null; payment_status: string; invoicing_status: string }
interface ExpenseDetail extends Expense { void_reason: string | null; pending_to_pay_minor: number | string; documented_minor: number | string; payments: PaymentRow[]; cfdi: CfdiLinkRow[] }
interface CfdiOpt { id: string; fiscal_uuid: string; series: string | null; folio: string | null; issuer_name: string | null; total_minor: number | string; pending_to_allocate_minor: number | string; currency: string; cfdi_type: string; sat_status: string }
const label = (i: { series: string | null; folio: string | null; fiscal_uuid: string }) => [i.series, i.folio].filter(Boolean).join("-") || i.fiscal_uuid.slice(0, 8);

export default function GastosPage() {
  const session = useSession(); const qc = useQueryClient();
  const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["expenses"], queryFn: () => api<{ managed_by: string; data: Expense[] }>("/expenses"), enabled: session.can("expense.read") });
  const refresh = () => Promise.all(["expenses", "expense", "cfdi", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (!session.can("expense.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver gastos.</p>;
  const erp = list.data?.managed_by === "ERP";
  const canManage = session.can("expense.manage") && !erp;
  const rows = list.data?.data ?? [];
  return (
    <>
      <PageHeader title="Gastos" description="Lo que gastó tu organización, su pago y los comprobantes fiscales que lo documentan."
        actions={canManage ? <Button onClick={() => setCreating(true)}><Plus />Registrar gasto</Button> : undefined} />
      {erp && <p role="status" className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">Los gastos de tu organización los lleva tu ERP. Procura le entrega la orden recibida y la factura ligada; aquí solo ves lo que el ERP te devuelva.</p>}
      {list.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><Receipt className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Aún no hay gastos</p>
          <p className="mt-1 text-sm text-muted-foreground">{canManage ? "Registra un gasto, regístrale pagos y lígalo a su factura." : "Cuando se registren aparecerán aquí."}</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Categoría</TableHead><TableHead>Proveedor</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Pago</TableHead><TableHead>Facturación</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((e) => (
            <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpenId(e.id)}>
              <TableCell>{dateShort(e.spent_at)}</TableCell><TableCell className="font-medium"><button className="text-left underline-offset-2 hover:underline" onClick={() => setOpenId(e.id)}>{e.description}</button></TableCell>
              <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell><TableCell className="text-muted-foreground">{e.supplier_name ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{money(e.amount_minor, e.currency)}</TableCell>
              <TableCell><StatusBadge {...(PAYMENT_STATUS[e.payment_status] ?? { label: e.payment_status, tone: "neutral" as const })} /></TableCell>
              <TableCell><StatusBadge {...(INVOICING_STATUS[e.invoicing_status] ?? { label: e.invoicing_status, tone: "neutral" as const })} /></TableCell>
            </TableRow>))}</TableBody>
        </Table></div>)}
      <NewExpense open={creating} onOpenChange={setCreating} onDone={refresh} />
      <ExpenseSheet id={openId} onClose={() => setOpenId(null)} canManage={canManage} onChange={refresh} />
    </>
  );
}

function NewExpense({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const { org, can } = useSession();
  const [f, setF] = useState({ spent_at: new Date().toISOString().slice(0, 10), description: "", category: "", amount: "", supplier_name: "", cfdi: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const currency = org?.base_currency ?? "MXN";
  const cfdis = useQuery({ queryKey: ["cfdi", "available", "RECEIVED"], queryFn: () => api<{ data: CfdiOpt[] }>("/cfdi?direction=RECEIVED"), enabled: open && can("cfdi.manage") });
  const mine = (cfdis.data?.data ?? []).filter((i) => i.currency === currency && i.cfdi_type === "I" && i.sat_status !== "CANCELADO" && Number(i.pending_to_allocate_minor) > 0);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api("/expenses", { body: { spent_at: f.spent_at, description: f.description.trim(), category: f.category.trim() || undefined, amount_minor: toMinor(f.amount), currency, supplier_name: f.supplier_name.trim() || undefined, cfdi_ids: f.cfdi ? [f.cfdi] : [] } });
      await onDone(); onOpenChange(false); setF({ ...f, description: "", category: "", amount: "", supplier_name: "", cfdi: "" });
    } catch (er) { setError(apiErr(er, "No se pudo registrar el gasto.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>Registrar gasto</DialogTitle><DialogDescription>Después podrás registrarle pagos parciales y ligarle su factura.</DialogDescription></DialogHeader>
      <form onSubmit={go} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="g-date">Fecha *</Label><Input id="g-date" type="date" required value={f.spent_at} onChange={(e) => setF({ ...f, spent_at: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="g-amt">Monto ({currency}) *</Label><Input id="g-amt" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="g-desc">Descripción *</Label><Input id="g-desc" required maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej. Aceite y filtros de motores" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="g-cat">Categoría</Label><Input id="g-cat" maxLength={80} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Insumos, servicios…" /></div>
          <div className="space-y-1.5"><Label htmlFor="g-sup">Proveedor</Label><Input id="g-sup" maxLength={200} value={f.supplier_name} onChange={(e) => setF({ ...f, supplier_name: e.target.value })} /></div>
        </div>
        {can("cfdi.manage") && <div className="space-y-1.5"><Label htmlFor="g-inv">Factura recibida (opcional)</Label>
          <select id="g-inv" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={f.cfdi} onChange={(e) => setF({ ...f, cfdi: e.target.value })}>
            <option value="">Sin ligar por ahora</option>{mine.map((i) => <option key={i.id} value={i.id}>{label(i)} · {i.issuer_name ?? "Proveedor"} · disponible {money(i.pending_to_allocate_minor, i.currency)}</option>)}</select></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !f.description.trim() || !f.amount.trim()}>Guardar gasto</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  );
}

function ExpenseSheet({ id, onClose, canManage, onChange }: { id: string | null; onClose: () => void; canManage: boolean; onChange: () => Promise<unknown> }) {
  const [voiding, setVoiding] = useState(false);
  const q = useQuery({ queryKey: ["expense", id], queryFn: () => api<ExpenseDetail>(`/expenses/${id}`), enabled: !!id });
  const e = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      {!e ? <div className="h-32 animate-pulse rounded bg-muted" /> : (<>
        <DialogHeader><DialogTitle>{e.description}</DialogTitle><DialogDescription>{dateShort(e.spent_at)} · {e.category ?? "Sin categoría"}{e.supplier_name ? ` · ${e.supplier_name}` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-5 text-sm">
          <div className="flex items-baseline justify-between"><span className="text-muted-foreground">Monto</span><span className="text-lg font-semibold tabular-nums">{money(e.amount_minor, e.currency)}</span></div>
          <div className="flex flex-wrap gap-1.5"><StatusBadge {...(PAYMENT_STATUS[e.payment_status] ?? { label: e.payment_status, tone: "neutral" as const })} /><StatusBadge {...(INVOICING_STATUS[e.invoicing_status] ?? { label: e.invoicing_status, tone: "neutral" as const })} /></div>
          {e.voided_at && <p className="rounded-lg bg-muted px-3 py-2">Gasto anulado: {e.void_reason}</p>}
          {e.order_id && <Link href={`/ordenes/${e.order_id}`} className="inline-block underline">Ver la orden</Link>}
          <PaymentsSection base={`/expenses/${e.id}`} payments={e.payments} currency={e.currency} pendingMinor={e.pending_to_pay_minor} voided={!!e.voided_at} kind="expense" onChange={onChange} />
          <CfdiSection base={`/expenses/${e.id}`} links={e.cfdi} currency={e.currency} totalMinor={e.amount_minor} documentedMinor={e.documented_minor} direction="RECEIVED" voided={!!e.voided_at} onChange={onChange} />
        </div>
        <DialogFooter>{canManage && !e.voided_at && <Button variant="destructive" onClick={() => setVoiding(true)}>Anular gasto</Button>}<Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
        <ActionDialog open={voiding} onOpenChange={setVoiding} title="Anular gasto" description="No se borra: queda anulado con tu motivo y sus CFDI se liberan. Antes hay que anular sus pagos." fieldLabel="Motivo" required destructive confirmLabel="Anular"
          onConfirm={async (c) => { await api(`/expenses/${e.id}/void`, { body: { reason: c } }); await onChange(); onClose(); }} />
      </>)}
    </DialogContent></Dialog>
  );
}
