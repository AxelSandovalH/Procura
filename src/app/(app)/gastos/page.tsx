"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Receipt, Unlink } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money, toMinor } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/ui/status";

interface Expense { id: string; spent_at: string; description: string; category: string | null; amount_minor: number | string; currency: string; supplier_name: string | null; order_id: string | null; source: string; voided_at: string | null; void_reason: string | null; invoice_count: number }
interface ExpenseDetail extends Omit<Expense, "invoice_count"> { invoices: { id: string; fiscal_uuid: string; series: string | null; folio: string | null; issuer_name: string | null; total_minor: number | string; currency: string; status: string }[]; invoices_total_minor: number | string; difference_minor: number | string | null; mixed_currency: boolean }
interface Invoice { id: string; fiscal_uuid: string; series: string | null; folio: string | null; issuer_name: string | null; total_minor: number | string; currency: string; status: string; expense_ids: string[] }
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);
const invLabel = (i: { series: string | null; folio: string | null; fiscal_uuid: string }) => [i.series, i.folio].filter(Boolean).join("-") || i.fiscal_uuid.slice(0, 8);

export default function GastosPage() {
  const session = useSession();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["expenses"], queryFn: () => api<{ managed_by: string; data: Expense[] }>("/expenses"), enabled: session.can("expense.read") });
  const refresh = () => Promise.all(["expenses", "expense", "invoices"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  if (!session.can("expense.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver gastos.</p>;
  const erp = list.data?.managed_by === "ERP";
  const canManage = session.can("expense.manage") && !erp;
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader title="Gastos" description="Lo que gastó tu organización, ligado a las facturas de tus proveedores."
        actions={canManage ? <Button onClick={() => setCreating(true)}><Plus />Registrar gasto</Button> : undefined} />
      {erp && <p role="status" className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">Los gastos de tu organización los lleva tu ERP. Procura le entrega la orden recibida y la factura ligada; aquí solo ves lo que el ERP te devuelva.</p>}
      {list.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><Receipt className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Aún no hay gastos</p>
          <p className="mt-1 text-sm text-muted-foreground">{canManage ? "Registra un gasto y lígalo a la factura de tu proveedor." : "Cuando se registren aparecerán aquí."}</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Categoría</TableHead><TableHead>Proveedor</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Facturas</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((e) => (
            <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpenId(e.id)}>
              <TableCell>{dateShort(e.spent_at)}</TableCell><TableCell className="font-medium"><button className="text-left underline-offset-2 hover:underline" onClick={() => setOpenId(e.id)}>{e.description}</button></TableCell>
              <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell><TableCell className="text-muted-foreground">{e.supplier_name ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{money(e.amount_minor, e.currency)}</TableCell>
              <TableCell>{e.invoice_count > 0 ? <StatusBadge label={`${e.invoice_count} ligada${e.invoice_count > 1 ? "s" : ""}`} tone="ok" /> : <StatusBadge label="Sin factura" tone="warn" />}</TableCell>
            </TableRow>))}</TableBody>
        </Table></div>
      )}
      <NewExpense open={creating} onOpenChange={setCreating} onDone={refresh} />
      <ExpenseSheet id={openId} onClose={() => setOpenId(null)} canManage={canManage} onChange={refresh} />
    </>
  );
}

function NewExpense({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const { org } = useSession();
  const [f, setF] = useState({ spent_at: new Date().toISOString().slice(0, 10), description: "", category: "", amount: "", supplier_name: "", invoice: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const currency = org?.base_currency ?? "MXN";
  const invoices = useQuery({ queryKey: ["invoices", "unlinked"], queryFn: () => api<{ data: Invoice[] }>("/invoices?unlinked=1"), enabled: open });
  const mine = (invoices.data?.data ?? []).filter((i) => i.currency === currency);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api("/expenses", { body: { spent_at: f.spent_at, description: f.description.trim(), category: f.category.trim() || undefined, amount_minor: toMinor(f.amount), currency, supplier_name: f.supplier_name.trim() || undefined, supplier_invoice_ids: f.invoice ? [f.invoice] : [] } });
      await onDone(); onOpenChange(false); setF({ ...f, description: "", category: "", amount: "", supplier_name: "", invoice: "" });
    } catch (er) { setError(err(er, "No se pudo registrar el gasto.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>Registrar gasto</DialogTitle><DialogDescription>Puedes ligarlo ahora a una factura recibida o hacerlo después.</DialogDescription></DialogHeader>
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
        <div className="space-y-1.5"><Label htmlFor="g-inv">Factura recibida (opcional)</Label>
          <select id="g-inv" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={f.invoice} onChange={(e) => setF({ ...f, invoice: e.target.value })}>
            <option value="">Sin ligar por ahora</option>
            {mine.map((i) => <option key={i.id} value={i.id}>{invLabel(i)} · {i.issuer_name ?? "Proveedor"} · {money(i.total_minor, i.currency)}</option>)}
          </select></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !f.description.trim() || !f.amount.trim()}>Guardar gasto</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  );
}

function ExpenseSheet({ id, onClose, canManage, onChange }: { id: string | null; onClose: () => void; canManage: boolean; onChange: () => Promise<unknown> }) {
  const [voiding, setVoiding] = useState(false); const [pick, setPick] = useState(""); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["expense", id], queryFn: () => api<ExpenseDetail>(`/expenses/${id}`), enabled: !!id });
  const free = useQuery({ queryKey: ["invoices", "unlinked"], queryFn: () => api<{ data: Invoice[] }>("/invoices?unlinked=1"), enabled: !!id && canManage });
  const e = q.data;
  async function link() { if (!pick) return; setError(null); try { await api(`/expenses/${id}/invoices`, { body: { supplier_invoice_id: pick } }); setPick(""); await onChange(); } catch (er) { setError(err(er, "No se pudo ligar.")); } }
  async function unlink(iid: string) { setError(null); try { await api(`/expenses/${id}/invoices/${iid}`, { method: "DELETE" }); await onChange(); } catch (er) { setError(err(er, "No se pudo desligar.")); } }
  const options = (free.data?.data ?? []).filter((i) => e && i.currency === e.currency);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}><DialogContent>
      {!e ? <div className="h-32 animate-pulse rounded bg-muted" /> : (<>
        <DialogHeader><DialogTitle>{e.description}</DialogTitle><DialogDescription>{dateShort(e.spent_at)} · {e.category ?? "Sin categoría"}{e.supplier_name ? ` · ${e.supplier_name}` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between"><span className="text-muted-foreground">Monto</span><span className="text-lg font-semibold tabular-nums">{money(e.amount_minor, e.currency)}</span></div>
          {e.voided_at && <p className="rounded-lg bg-muted px-3 py-2">Gasto anulado: {e.void_reason}</p>}
          {e.order_id && <Link href={`/ordenes/${e.order_id}`} className="inline-block underline">Ver la orden</Link>}
          <div><p className="mb-1.5 font-medium">Facturas ligadas</p>
            {e.invoices.length === 0 ? <p className="text-muted-foreground">Sin facturas ligadas.</p> : <ul className="space-y-1.5">{e.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"><span><span className="font-medium">{invLabel(i)}</span> <span className="text-muted-foreground">· {i.issuer_name ?? "Proveedor"} · {money(i.total_minor, i.currency)}</span></span>
                <span className="flex items-center gap-1.5"><StatusBadge {...(INVOICE_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const })} />{canManage && !e.voided_at && <Button size="icon" variant="ghost" aria-label="Desligar factura" onClick={() => void unlink(i.id)}><Unlink /></Button>}</span></li>))}</ul>}
            {e.invoices.length > 0 && e.difference_minor != null && Number(e.difference_minor) !== 0 && !e.mixed_currency && <p className="mt-2 text-amber-700 dark:text-amber-400">El gasto difiere de lo facturado por {money(Math.abs(Number(e.difference_minor)), e.currency)} ({Number(e.difference_minor) > 0 ? "falta facturar" : "se facturó de más"}).</p>}
          </div>
          {canManage && !e.voided_at && <div className="flex gap-2"><select aria-label="Factura a ligar" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm" value={pick} onChange={(ev) => setPick(ev.target.value)}>
            <option value="">Ligar una factura recibida…</option>{options.map((i) => <option key={i.id} value={i.id}>{invLabel(i)} · {i.issuer_name ?? "Proveedor"} · {money(i.total_minor, i.currency)}</option>)}</select>
            <Button variant="outline" onClick={() => void link()} disabled={!pick}><Link2 />Ligar</Button></div>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>{canManage && !e.voided_at && <Button variant="destructive" onClick={() => setVoiding(true)}>Anular gasto</Button>}<Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
        <ActionDialog open={voiding} onOpenChange={setVoiding} title="Anular gasto" description="No se borra: queda anulado con tu motivo y sus facturas se liberan." fieldLabel="Motivo" required destructive confirmLabel="Anular"
          onConfirm={async (c) => { await api(`/expenses/${e.id}/void`, { body: { reason: c } }); await onChange(); onClose(); }} />
      </>)}
    </DialogContent></Dialog>
  );
}
