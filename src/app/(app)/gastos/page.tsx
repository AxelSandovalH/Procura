"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, FileClock, FileX2, Plus, Receipt } from "lucide-react";
import { ReceiptPreview } from "@/components/app/receipt-preview";
import { ExpenseNotes } from "@/components/app/expense-notes";
import { BillingDataCard } from "@/components/app/billing-data";
import { ScanReceiptButton } from "@/components/app/scan-receipt";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { AttachReceiptButton } from "@/components/app/attach-receipt";
import { EditExpenseButton } from "@/components/app/edit-expense";
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
import { INVOICING_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/ui/status";

interface Expense { id: string; spent_at: string; description: string; category: string | null; amount_minor: number | string; currency: string; supplier_name: string | null; order_id: string | null; source: string; voided_at: string | null; payment_status: string; invoicing_status: string; cfdi_count?: number; cfdi_uuid_hint?: string | null }
interface ExpenseDetail extends Expense { void_reason: string | null; pending_to_pay_minor: number | string; documented_minor: number | string; payments: PaymentRow[]; cfdi: CfdiLinkRow[] }
interface CfdiOpt { id: string; fiscal_uuid: string; series: string | null; folio: string | null; issuer_name: string | null; total_minor: number | string; pending_to_allocate_minor: number | string; currency: string; cfdi_type: string; sat_status: string }
const label = (i: { series: string | null; folio: string | null; fiscal_uuid: string }) => [i.series, i.folio].filter(Boolean).join("-") || i.fiscal_uuid.slice(0, 8);

export default function GastosPage() {
  const session = useSession(); const qc = useQueryClient();
  const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [paying, setPaying] = useState(false);
  const list = useQuery({ queryKey: ["expenses"], queryFn: () => api<{ managed_by: string; data: Expense[] }>("/expenses"), enabled: session.can("expense.read") });
  const refresh = () => Promise.all(["expenses", "expense", "cfdi", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (!session.can("expense.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver gastos.</p>;
  const erp = list.data?.managed_by === "ERP";
  const canManage = session.can("expense.manage") && !erp;
  const rows = list.data?.data ?? [];
  const unpaid = canManage && session.can("payment.manage") ? rows.filter((e) => e.payment_status === "PENDING" || e.payment_status === "PARTIAL") : [];
  const chosen = [...picked].filter((id) => unpaid.some((e) => e.id === id));
  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <PageHeader title="Gastos" description="Lo que gastó tu organización, su pago y los comprobantes fiscales que lo documentan."
        actions={canManage ? <div className="flex gap-2"><ScanReceiptButton onSaved={refresh} /><Button onClick={() => setCreating(true)}><Plus />Registrar gasto</Button></div> : undefined} />
      {erp && <p role="status" className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">Los gastos de tu organización los lleva tu ERP. Procura le entrega la orden recibida y la factura ligada; aquí solo ves lo que el ERP te devuelva.</p>}
      {chosen.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><span>{chosen.length} seleccionado{chosen.length > 1 ? "s" : ""}</span><Button size="sm" onClick={() => setPaying(true)}>Marcar como pagados</Button><Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Quitar selección</Button></div>}
      {list.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><Receipt className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Aún no hay gastos</p>
          <p className="mt-1 text-sm text-muted-foreground">{canManage ? "Registra un gasto, regístrale pagos y lígalo a su factura." : "Cuando se registren aparecerán aquí."}</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow>{unpaid.length > 0 && <TableHead className="w-8"><input type="checkbox" aria-label="Seleccionar todos los gastos por pagar" checked={chosen.length === unpaid.length} onChange={(e) => setPicked(e.target.checked ? new Set(unpaid.map((x) => x.id)) : new Set())} /></TableHead>}<TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Proveedor</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Pago</TableHead><TableHead>CFDI ligado</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((e) => (
            <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpenId(e.id)}>
              {unpaid.length > 0 && <TableCell onClick={(ev) => ev.stopPropagation()}>{unpaid.some((x) => x.id === e.id) ? <input type="checkbox" aria-label={`Seleccionar ${e.description}`} checked={picked.has(e.id)} onChange={() => toggle(e.id)} /> : null}</TableCell>}
              <TableCell className="whitespace-nowrap">{dateShort(e.spent_at)}</TableCell>
              <TableCell className="max-w-[22rem]"><button className="block max-w-full truncate text-left font-medium underline-offset-2 hover:underline" title={e.description} onClick={() => setOpenId(e.id)}>{e.description}</button>{e.category && <span className="block truncate text-xs text-muted-foreground">{e.category}</span>}</TableCell>
              <TableCell className="max-w-[12rem] truncate text-muted-foreground" title={e.supplier_name ?? undefined}>{e.supplier_name ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{money(e.amount_minor, e.currency)}</TableCell>
              <TableCell><StatusBadge {...(PAYMENT_STATUS[e.payment_status] ?? { label: e.payment_status, tone: "neutral" as const })} /></TableCell>
              <TableCell><XmlBadge status={e.invoicing_status} count={e.cfdi_count ?? 0} voided={!!e.voided_at} awaiting={!!e.cfdi_uuid_hint && (e.cfdi_count ?? 0) === 0} /></TableCell>
            </TableRow>))}</TableBody>
        </Table></div>)}
      <MarkPaid ids={chosen} open={paying} onOpenChange={setPaying} onDone={async () => { setPicked(new Set()); await refresh(); }} />
      <NewExpense open={creating} onOpenChange={setCreating} onDone={refresh} />
      <ExpenseSheet id={openId} onClose={() => setOpenId(null)} canManage={canManage} onChange={refresh} />
    </>
  );
}

function NewExpense({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const { org, can } = useSession();
  const [f, setF] = useState({ spent_at: new Date().toISOString().slice(0, 10), description: "", category: "", amount: "", supplier_name: "", cfdi: "", paid: false, method: "TRANSFER" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const currency = org?.base_currency ?? "MXN";
  const cfdis = useQuery({ queryKey: ["cfdi", "available", "RECEIVED"], queryFn: () => api<{ data: CfdiOpt[] }>("/cfdi?direction=RECEIVED"), enabled: open && can("cfdi.manage") });
  const mine = (cfdis.data?.data ?? []).filter((i) => i.currency === currency && i.cfdi_type === "I" && i.sat_status !== "CANCELADO" && Number(i.pending_to_allocate_minor) > 0);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api("/expenses", { body: { spent_at: f.spent_at, description: f.description.trim(), category: f.category.trim() || undefined, amount_minor: toMinor(f.amount), currency, supplier_name: f.supplier_name.trim() || undefined, cfdi_ids: f.cfdi ? [f.cfdi] : [], ...(f.paid && can("payment.manage") ? { paid: { method: f.method } } : {}) } });
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
        {can("payment.manage") && <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />Ya está pagado</label>{f.paid && <select aria-label="Forma de pago" className="h-9 rounded-lg border bg-background px-2 text-sm" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</div>}
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
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[92vh] overflow-y-auto overflow-x-hidden sm:max-w-5xl">
      {!e ? <div className="h-32 animate-pulse rounded bg-muted" /> : (<>
        <DialogHeader><DialogTitle className="break-words pr-6">{e.description}</DialogTitle><DialogDescription>{dateShort(e.spent_at)} · {e.category ?? "Sin categoría"}{e.supplier_name ? ` · ${e.supplier_name}` : ""}</DialogDescription></DialogHeader>
        <div className="grid min-w-0 gap-6 text-sm md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* Columna izquierda: el comprobante (ticket o PDF) y el estado del gasto. En pantalla ancha se queda a la vista al desplazarse. */}
          <div className="min-w-0 space-y-4 md:sticky md:top-0 md:self-start">
            <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">Monto</span><span className="text-lg font-semibold tabular-nums">{money(e.amount_minor, e.currency)}</span></div>
            <div className="flex flex-wrap gap-1.5"><StatusBadge {...(PAYMENT_STATUS[e.payment_status] ?? { label: e.payment_status, tone: "neutral" as const })} /><StatusBadge {...(INVOICING_STATUS[e.invoicing_status] ?? { label: e.invoicing_status, tone: "neutral" as const })} /></div>
            {e.voided_at && <p className="rounded-lg bg-muted px-3 py-2">Gasto anulado: {e.void_reason}</p>}
            {e.order_id && <Link href={`/ordenes/${e.order_id}`} className="inline-block underline">Ver la orden</Link>}
            {canManage && !e.voided_at && <AttachReceiptButton expenseId={e.id} />}
            <ReceiptPreview expenseId={e.id} />
          </div>
          {/* Columna derecha: lo que se hace con el gasto. */}
          <div className="min-w-0 space-y-5">
            {e.cfdi_uuid_hint && e.cfdi.length === 0 && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">Subiste la factura en PDF (folio fiscal <span className="break-all font-mono">{e.cfdi_uuid_hint}</span>), pero falta su XML. En cuanto llegue por la descarga del SAT o lo cargues, se liga solo a este gasto.</p>}
            <BillingDataCard paymentMethod={e.payments.find((p) => !p.voided_at)?.method} />
            <PaymentsSection base={`/expenses/${e.id}`} payments={e.payments} currency={e.currency} pendingMinor={e.pending_to_pay_minor} voided={!!e.voided_at} kind="expense" onChange={onChange} />
            <CfdiSection base={`/expenses/${e.id}`} links={e.cfdi} currency={e.currency} totalMinor={e.amount_minor} documentedMinor={e.documented_minor} direction="RECEIVED" voided={!!e.voided_at} onChange={onChange} />
            <ExpenseNotes expenseId={e.id} canWrite={canManage} />
          </div>
        </div>
        <DialogFooter>{canManage && !e.voided_at && <EditExpenseButton expense={{ ...e, paid_minor: Number(e.amount_minor) - Number(e.pending_to_pay_minor) }} onDone={onChange} />}{canManage && !e.voided_at && <Button variant="destructive" onClick={() => setVoiding(true)}>Anular gasto</Button>}<Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
        <ActionDialog open={voiding} onOpenChange={setVoiding} title="Anular gasto" description="No se borra: queda anulado con tu motivo y sus CFDI se liberan. Antes hay que anular sus pagos." fieldLabel="Motivo" required destructive confirmLabel="Anular"
          onConfirm={async (c) => { await api(`/expenses/${e.id}/void`, { body: { reason: c } }); await onChange(); onClose(); }} />
      </>)}
    </DialogContent></Dialog>
  );
}

/** Marca varios gastos como pagados en un paso (pago por lo que falta, con la fecha de cada gasto). */
function MarkPaid({ ids, open, onOpenChange, onDone }: { ids: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [method, setMethod] = useState("CARD"); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ summary: { paid: number; skipped: number; errors: number } } | null>(null);
  async function go() { setBusy(true); setError(null); try { setOut(await api("/expenses/mark-paid", { body: { expense_ids: ids, method } })); await onDone(); } catch (e) { setError(apiErr(e, "No se pudieron marcar como pagados.")); } finally { setBusy(false); } }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setOut(null); setError(null); } }}><DialogContent>
      <DialogHeader><DialogTitle>Marcar {ids.length} gasto{ids.length === 1 ? "" : "s"} como pagado{ids.length === 1 ? "" : "s"}</DialogTitle><DialogDescription>Se registra un pago por lo que falte de cada gasto, con la fecha del propio gasto. Cada pago se puede anular después, uno por uno.</DialogDescription></DialogHeader>
      {!out ? <div className="space-y-3"><div className="space-y-1.5"><Label htmlFor="mp-m">Forma de pago</Label><select id="mp-m" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>
        : <p role="status" className="text-sm font-medium">{out.summary.paid} marcado{out.summary.paid === 1 ? "" : "s"} como pagado{out.summary.paid === 1 ? "" : "s"}{out.summary.skipped ? ` · ${out.summary.skipped} omitido${out.summary.skipped === 1 ? "" : "s"}` : ""}{out.summary.errors ? ` · ${out.summary.errors} con error` : ""}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{out ? "Cerrar" : "Cancelar"}</Button>{!out && <Button onClick={() => void go()} disabled={busy}>{busy ? "Registrando…" : "Marcar como pagados"}</Button>}</DialogFooter>
    </DialogContent></Dialog>
  );
}

/** ¿Tiene XML (CFDI) ligado? Lo más visible de la lista: verde con palomita = sí; ámbar = parcial; rojo suave = sin XML. */
function XmlBadge({ status, count, voided, awaiting = false }: { status: string; count: number; voided: boolean; awaiting?: boolean }) {
  if (voided) return <span className="text-xs text-muted-foreground">—</span>;
  const [cls, Icon, text] = status === "INVOICED" ? ["border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300", FileCheck2, count > 1 ? `${count} CFDI ligados` : "CFDI ligado"]
    : status === "PARTIAL" ? ["border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300", FileClock, "CFDI parcial"]
    : awaiting ? ["border-dashed border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300", FileClock, "CFDI en PDF"] as const
    : ["border-dashed border-muted-foreground/40 text-muted-foreground", FileX2, "Sin CFDI"] as const;
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${cls}`}><Icon className="size-3.5" aria-hidden />{text}</span>;
}
