"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus, Check, FilePen, Plus, Send, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { CollaborationPanel } from "@/components/app/collaboration-panel";
import { ActionDialog } from "@/components/app/action-dialog";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money, qty, toMinor } from "@/lib/format";
import { QUOTATION_STATUS } from "@/lib/ui/status";
import { useSyncedState } from "@/hooks/use-synced-state";

interface QLine { id: string; rfq_line_id: string | null; line_kind: string; name: string; quantity: string; unit_label: string; unit_price_minor: number | string; line_total_minor: number | string; lead_time_days: number | null; notes: string | null }
interface Quotation {
  id: string; rfq_id: string; quotation_number: string; version: number; status: string; updated_at?: string; currency: string; perspective: "BUYER" | "SUPPLIER";
  subtotal_minor: number | string; tax_minor: number | string; total_minor: number | string; valid_until: string | null; lead_time_days: number | null;
  delivery_terms: string | null; payment_terms: string | null; notes: string | null; quotation_lines: QLine[]; available_actions: string[];
}
interface Rfq { id: string; supplier: { display_name: string }; buyer: { display_name: string }; lines: { id: string; name: string; quantity: string; unit_label: string }[] }

const KIND: Record<string, string> = { AS_REQUESTED: "Como se pidió", SUBSTITUTE: "Sustituto", ALTERNATIVE_QUANTITY: "Cantidad alternativa", ADDITIONAL: "Adicional", DECLINED: "No cotiza" };
const minorToInput = (m: number | string) => (Number(m) / 100).toFixed(2);

export default function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<"reject" | "extend" | null>(null);

  const quote = useQuery({ queryKey: ["quotation", id], queryFn: () => api<Quotation>(`/quotations/${id}`) });
  const rfq = useQuery({ queryKey: ["rfq", quote.data?.rfq_id], queryFn: () => api<Rfq>(`/rfqs/${quote.data!.rfq_id}`), enabled: !!quote.data });
  const refresh = () => Promise.all(["quotation", "rfq-quotations", "rfqs", "req-quotations", "orders"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const fail = (e: unknown) => setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo completar la acción.");

  const q = quote.data;
  const [head, setHead] = useSyncedState(() => ({ valid_until: q?.valid_until?.slice(0, 10) ?? "", lead_time_days: q?.lead_time_days?.toString() ?? "", tax: q ? minorToInput(q.tax_minor) : "0.00", payment_terms: q?.payment_terms ?? "", delivery_terms: q?.delivery_terms ?? "", notes: q?.notes ?? "" }), q ? `${q.id}:${q.version}:${q.status}:${q.updated_at ?? ""}` : "");

  if (quote.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!q) return <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Cotización no encontrada</p><Link href="/solicitudes" className="mt-2 inline-block text-sm underline">Volver</Link></div>;

  const has = (a: string) => q.available_actions.includes(a);
  const editing = q.perspective === "SUPPLIER" && q.status === "DRAFT" && has("update");
  const st = QUOTATION_STATUS[q.status] ?? { label: q.status, tone: "neutral" as const };
  const covered = new Set(q.quotation_lines.map((l) => l.rfq_line_id));
  const missing = (rfq.data?.lines ?? []).filter((l) => !covered.has(l.id));

  async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const saveHead = () => api(`/quotations/${id}`, { method: "PATCH", body: {
    valid_until: head.valid_until || undefined, lead_time_days: head.lead_time_days === "" ? null : Number(head.lead_time_days),
    tax_minor: toMinor(head.tax), payment_terms: head.payment_terms.trim() || null, delivery_terms: head.delivery_terms.trim() || null, notes: head.notes.trim() || null,
  } });
  const addMissing = () => guard(async () => {
    for (const l of missing) await api(`/quotations/${id}/lines`, { method: "POST", body: { rfq_line_id: l.id, name: l.name, quantity: Number(l.quantity), unit_label: l.unit_label, unit_price_minor: 0 } });
    await refresh();
  });
  const submit = () => guard(async () => { await saveHead(); await api(`/quotations/${id}/submit`, { method: "POST", body: {} }); await refresh(); });
  const simple = (path: string) => guard(async () => { await api(`/quotations/${id}/${path}`, { method: "POST", body: {} }); await refresh(); });
  const revise = () => guard(async () => { const n = await api<{ id: string }>(`/quotations/${id}/revise`, { method: "POST", body: {} }); await refresh(); router.push(`/cotizaciones/${n.id}`); });
  const accept = () => guard(async () => { const r = await api<{ approval_required: boolean; order: { id: string } | null }>(`/quotations/${id}/accept`, { method: "POST", body: {} }); await refresh(); if (r.order) router.push(`/ordenes/${r.order.id}`); else setNote("Compra enviada a aprobación. Cuando se apruebe se creará la orden."); });

  return (
    <>
      <Link href={`/solicitudes/${q.rfq_id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Solicitud</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2"><span className="font-mono text-sm text-muted-foreground">{q.quotation_number}</span><StatusBadge {...st} />{q.version > 1 && <span className="text-xs text-muted-foreground">v{q.version}</span>}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{q.perspective === "SUPPLIER" ? `Cotización para ${rfq.data?.buyer.display_name ?? "…"}` : `Cotización de ${rfq.data?.supplier.display_name ?? "…"}`}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {has("submit") && <Button onClick={submit} disabled={busy}><Send />Enviar cotización</Button>}
          {has("revise") && <Button variant="outline" onClick={revise} disabled={busy}><FilePen />Revisar</Button>}
          {has("extend") && <Button variant="outline" onClick={() => setDlg("extend")}><CalendarPlus />Extender vigencia</Button>}
          {has("withdraw") && <Button variant="outline" onClick={() => simple("withdraw")} disabled={busy}><Undo2 />Retirar</Button>}
          {has("accept") && <Button onClick={accept} disabled={busy}><Check />Comprar esta</Button>}
          {has("reject") && <Button variant="destructive" onClick={() => setDlg("reject")}><X />Rechazar</Button>}
        </div>
      </div>
      {note && <p role="status" className="mb-4 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-sm">{note}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Líneas</CardTitle>{editing && missing.length > 0 && <Button size="sm" variant="outline" onClick={addMissing} disabled={busy}><Plus />Cargar {missing.length} de la solicitud</Button>}</div></CardHeader>
          <CardContent className="px-0"><div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Concepto</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">P. unitario</TableHead><TableHead className="text-right">Entrega (días)</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
            <TableBody>
              {q.quotation_lines.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">{editing ? "Carga las líneas de la solicitud para empezar a poner precios." : "Sin líneas."}</TableCell></TableRow>}
              {q.quotation_lines.map((l) => editing ? <EditableLine key={l.id} quotationId={id} line={l} onSaved={refresh} onError={fail} /> : (
                <TableRow key={l.id}>
                  <TableCell><div className="font-medium">{l.name}</div>{l.line_kind !== "AS_REQUESTED" && <div className="text-xs text-amber-700 dark:text-amber-400">{KIND[l.line_kind] ?? l.line_kind}</div>}{l.notes && <div className="text-xs text-muted-foreground">{l.notes}</div>}</TableCell>
                  <TableCell className="text-right tabular-nums">{qty(l.quantity)} {l.unit_label}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.line_kind === "DECLINED" ? "—" : money(l.unit_price_minor, q.currency)}</TableCell>
                  <TableCell className="text-right">{l.lead_time_days ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.line_kind === "DECLINED" ? "—" : money(l.line_total_minor, q.currency)}</TableCell>
                </TableRow>))}
            </TableBody>
          </Table></div>
          <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 px-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(q.subtotal_minor, q.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Impuestos</dt><dd className="tabular-nums">{money(q.tax_minor, q.currency)}</dd></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(q.total_minor, q.currency)}</dd></div>
          </dl></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Condiciones</CardTitle></CardHeader>
          <CardContent>{editing ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await saveHead(); await refresh(); }); }}>
              <div className="space-y-1.5"><Label htmlFor="vu">Vigente hasta *</Label><Input id="vu" type="date" value={head.valid_until} onChange={(e) => setHead({ ...head, valid_until: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="lt">Entrega (días)</Label><Input id="lt" type="number" min={0} value={head.lead_time_days} onChange={(e) => setHead({ ...head, lead_time_days: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="tax">Impuestos ({q.currency})</Label><Input id="tax" inputMode="decimal" value={head.tax} onChange={(e) => setHead({ ...head, tax: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="pt">Condiciones de pago</Label><Input id="pt" value={head.payment_terms} onChange={(e) => setHead({ ...head, payment_terms: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="dt">Condiciones de entrega</Label><Input id="dt" value={head.delivery_terms} onChange={(e) => setHead({ ...head, delivery_terms: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="nt">Notas</Label><Textarea id="nt" rows={2} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></div>
              <Button type="submit" variant="outline" className="w-full" disabled={busy}>Guardar condiciones</Button>
            </form>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Vigente hasta</dt><dd>{dateShort(q.valid_until)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Entrega</dt><dd>{q.lead_time_days != null ? `${q.lead_time_days} días` : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Pago</dt><dd className="text-right">{q.payment_terms ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Entrega</dt><dd className="text-right">{q.delivery_terms ?? "—"}</dd></div>
              {q.notes && <p className="rounded-lg bg-muted px-3 py-2">{q.notes}</p>}
            </dl>)}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6"><CollaborationPanel anchorType="QUOTATION" anchorId={q.id} counterpartName={q.perspective === "SUPPLIER" ? rfq.data?.buyer.display_name : rfq.data?.supplier.display_name} /></div>

      <ActionDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} title="Rechazar cotización" description="El proveedor verá tu motivo." fieldLabel="Motivo" required destructive confirmLabel="Rechazar"
        onConfirm={async (c) => { await api(`/quotations/${id}/reject`, { method: "POST", body: { reason: c } }); await refresh(); }} />
      <ExtendDialog open={dlg === "extend"} onOpenChange={(o) => !o && setDlg(null)} onConfirm={async (d) => { await api(`/quotations/${id}/extend`, { method: "POST", body: { valid_until: d } }); await refresh(); }} />
    </>
  );
}

/** Cada línea se guarda al salir del campo; los totales los recalcula el servidor. */
function EditableLine({ quotationId, line, onSaved, onError }: { quotationId: string; line: QLine; onSaved: () => unknown; onError: (e: unknown) => void }) {
  const declined = line.line_kind === "DECLINED";
  const key = `${line.id}:${line.unit_price_minor}:${line.quantity}:${line.lead_time_days}`;
  const [price, setPrice] = useSyncedState(() => minorToInput(line.unit_price_minor), key);
  const [quantity, setQuantity] = useSyncedState(() => String(Number(line.quantity)), key);
  const [lead, setLead] = useSyncedState(() => line.lead_time_days?.toString() ?? "", key);

  async function patch(body: Record<string, unknown>) {
    try { await api(`/quotations/${quotationId}/lines/${line.id}`, { method: "PATCH", body }); await onSaved(); } catch (e) { onError(e); }
  }
  const changed = toMinor(price) !== Number(line.unit_price_minor) || Number(quantity) !== Number(line.quantity) || (lead === "" ? null : Number(lead)) !== line.lead_time_days;
  const save = () => { if (changed && Number(quantity) >= 0) void patch({ unit_price_minor: toMinor(price), quantity: Number(quantity), lead_time_days: lead === "" ? null : Number(lead) }); };

  return (
    <TableRow>
      <TableCell><div className="font-medium">{line.name}</div><label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={declined} onChange={(e) => void patch({ line_kind: e.target.checked ? "DECLINED" : "AS_REQUESTED" })} />No cotizo este concepto</label></TableCell>
      <TableCell className="text-right"><Input aria-label={`Cantidad de ${line.name}`} className="ml-auto h-8 w-24 text-right" inputMode="decimal" value={quantity} disabled={declined} onChange={(e) => setQuantity(e.target.value)} onBlur={save} /><span className="text-xs text-muted-foreground">{line.unit_label}</span></TableCell>
      <TableCell className="text-right"><Input aria-label={`Precio unitario de ${line.name}`} className="ml-auto h-8 w-28 text-right" inputMode="decimal" value={price} disabled={declined} onChange={(e) => setPrice(e.target.value)} onBlur={save} /></TableCell>
      <TableCell className="text-right"><Input aria-label={`Días de entrega de ${line.name}`} className="ml-auto h-8 w-20 text-right" inputMode="numeric" value={lead} disabled={declined} onChange={(e) => setLead(e.target.value)} onBlur={save} /></TableCell>
      <TableCell className="text-right tabular-nums">{declined ? "—" : money(line.line_total_minor)}</TableCell>
    </TableRow>
  );
}

function ExtendDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (date: string) => Promise<unknown> }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(date); onOpenChange(false); } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo extender."); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}><DialogContent>
      <DialogHeader><DialogTitle>Extender vigencia</DialogTitle><DialogDescription>Nueva fecha límite para aceptar esta cotización.</DialogDescription></DialogHeader>
      <div className="space-y-1.5"><Label htmlFor="ext">Vigente hasta</Label><Input id="ext" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || !date}>Extender</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}
