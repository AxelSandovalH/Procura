"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, qty } from "@/lib/format";
import type { Tone } from "@/lib/ui/status";

export interface OrderLine { id: string; name: string; quantity: string; unit_label: string; delivered_quantity: string }
interface DLine { id: string; order_line_id: string; quantity_delivered: string; notes: string | null }
interface Delivery { id: string; delivery_number: number; status: string; delivered_at: string; carrier: string | null; tracking_ref: string | null; notes: string | null; cancel_reason: string | null; delivery_lines: DLine[]; receipts: { id: string; status: string } | null }

const DISCREPANCY: Record<string, string> = { SHORTAGE: "Faltante", OVERAGE: "Sobrante", DAMAGED: "Dañado", WRONG_ITEM: "Artículo equivocado", QUALITY: "Calidad", OTHER: "Otro" };
function state(d: Delivery): { label: string; tone: Tone } {
  if (d.status === "CANCELLED") return { label: "Cancelada", tone: "muted" };
  if (d.receipts?.status === "CONFIRMED") return { label: "Recibida", tone: "ok" };
  if (d.receipts?.status === "CONFIRMED_WITH_DISCREPANCIES") return { label: "Recibida con discrepancias", tone: "warn" };
  return { label: "Por recibir", tone: "info" };
}
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function DeliveriesCard({ orderId, perspective, orderStatus, lines, availableActions }: { orderId: string; perspective: "BUYER" | "SUPPLIER"; orderStatus: string; lines: OrderLine[]; availableActions: string[] }) {
  const session = useSession();
  const qc = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [receiving, setReceiving] = useState<Delivery | null>(null);
  const [cancelling, setCancelling] = useState<Delivery | null>(null);
  const deliveries = useQuery({ queryKey: ["deliveries", orderId], queryFn: () => api<{ data: Delivery[] }>(`/orders/${orderId}/deliveries`) });
  const refresh = () => Promise.all(["deliveries", "order", "orders", "requisition"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const lineName = (id: string) => lines.find((l) => l.id === id);
  const list = deliveries.data?.data ?? [];
  const canReceive = perspective === "BUYER" && session.can("receipt.confirm");
  const canCancel = perspective === "SUPPLIER" && session.can("delivery.register");

  return (
    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Entregas</CardTitle>
        {availableActions.includes("register_delivery") && <Button size="sm" variant="outline" onClick={() => setRegisterOpen(true)}><Truck />Registrar entrega</Button>}</div></CardHeader>
      <CardContent className="space-y-3">
        {deliveries.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{perspective === "SUPPLIER" ? "Aún no registras entregas." : "El proveedor todavía no registra entregas."}</p>
        ) : list.map((d) => {
          const st = state(d);
          const pending = d.status === "REGISTERED" && d.receipts?.status === "PENDING";
          return (
            <div key={d.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><span className="font-medium">Entrega #{d.delivery_number}</span><StatusBadge {...st} /><span className="text-xs text-muted-foreground">{dateShort(d.delivered_at)}</span></div>
                {pending && <div className="flex gap-1.5">
                  {canReceive && <Button size="sm" onClick={() => setReceiving(d)}><PackageCheck />Confirmar recepción</Button>}
                  {canCancel && <Button size="sm" variant="outline" onClick={() => setCancelling(d)}>Cancelar entrega</Button>}
                </div>}
              </div>
              <ul className="mt-2 space-y-0.5 text-muted-foreground">{d.delivery_lines.map((l) => <li key={l.id}>{qty(l.quantity_delivered)} {lineName(l.order_line_id)?.unit_label} · {lineName(l.order_line_id)?.name}</li>)}</ul>
              {(d.carrier || d.tracking_ref) && <p className="mt-1 text-xs text-muted-foreground">{[d.carrier, d.tracking_ref].filter(Boolean).join(" · ")}</p>}
              {d.notes && <p className="mt-1 text-xs">{d.notes}</p>}
              {d.cancel_reason && <p className="mt-1 text-xs text-muted-foreground">Motivo de cancelación: {d.cancel_reason}</p>}
            </div>);
        })}
      </CardContent>
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} orderId={orderId} lines={lines} orderStatus={orderStatus} onDone={refresh} />
      <ReceiptDialog delivery={receiving} onClose={() => setReceiving(null)} lines={lines} onDone={refresh} />
      <ActionDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} title="Cancelar entrega" description={cancelling ? `Entrega #${cancelling.delivery_number}` : undefined} fieldLabel="Motivo" required destructive confirmLabel="Cancelar entrega"
        onConfirm={async (c) => { await api(`/deliveries/${cancelling!.id}/cancel`, { method: "POST", body: { reason: c } }); await refresh(); }} />
    </Card>
  );
}

function RegisterDialog({ open, onOpenChange, orderId, lines, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; orderId: string; lines: OrderLine[]; orderStatus: string; onDone: () => unknown }) {
  const remaining = (l: OrderLine) => Math.max(0, Number(l.quantity) - Number(l.delivered_quantity));
  const [q, setQ] = useState<Record<string, string>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [carrier, setCarrier] = useState(""); const [tracking, setTracking] = useState(""); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const val = (l: OrderLine) => q[l.id] ?? String(remaining(l));
  const chosen = lines.filter((l) => num(val(l)) > 0);
  const invalid = lines.some((l) => { const n = num(val(l)); return Number.isNaN(n) || n < 0 || n > remaining(l) + 1e-9; });

  async function go() {
    setBusy(true); setError(null);
    try {
      await api(`/orders/${orderId}/deliveries`, { method: "POST", body: { delivered_at: date, carrier: carrier.trim() || undefined, tracking_ref: tracking.trim() || undefined, notes: notes.trim() || undefined, lines: chosen.map((l) => ({ order_line_id: l.id, quantity_delivered: num(val(l)) })) } });
      await onDone(); setQ({}); setCarrier(""); setTracking(""); setNotes(""); onOpenChange(false);
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo registrar."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Registrar entrega</DialogTitle><DialogDescription>Indica lo que envías ahora; puedes hacer entregas parciales.</DialogDescription></DialogHeader>
        <div className="space-y-2">{lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0"><p className="truncate font-medium">{l.name}</p><p className="text-xs text-muted-foreground">Pendiente: {qty(remaining(l))} {l.unit_label}</p></div>
            <Input aria-label={`Cantidad de ${l.name}`} className="h-8 w-28 text-right" inputMode="decimal" value={val(l)} disabled={remaining(l) === 0} onChange={(e) => setQ({ ...q, [l.id]: e.target.value })} />
          </div>))}</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="d-date">Fecha</Label><Input id="d-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="d-car">Transportista</Label><Input id="d-car" value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="d-trk">Guía / referencia</Label><Input id="d-trk" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="d-notes">Notas</Label><Textarea id="d-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || invalid || chosen.length === 0 || !date}>{busy ? "Registrando…" : "Registrar entrega"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RState { received: string; rejected: string; type: string; notes: string }
function ReceiptDialog({ delivery, onClose, lines, onDone }: { delivery: Delivery | null; onClose: () => void; lines: OrderLine[]; onDone: () => unknown }) {
  const [st, setSt] = useState<Record<string, RState>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  if (!delivery) return <Dialog open={false} onOpenChange={() => {}}><DialogContent /></Dialog>;
  const d = delivery;
  const get = (l: DLine): RState => st[l.id] ?? { received: String(Number(l.quantity_delivered)), rejected: "0", type: "", notes: "" };
  const set = (l: DLine, patch: Partial<RState>) => setSt({ ...st, [l.id]: { ...get(l), ...patch } });
  const rows = d.delivery_lines.map((l) => {
    const s = get(l); const rec = num(s.received); const rej = num(s.rejected);
    const bad = Number.isNaN(rec) || Number.isNaN(rej) || rec < 0 || rej < 0 || rej > rec || rec > Number(l.quantity_delivered) + 1e-9 || (rej > 0 && !s.type);
    return { l, s, rec, rej, bad };
  });

  async function go() {
    setBusy(true); setError(null);
    try {
      await api(`/deliveries/${d.id}/receipt/confirm`, { method: "POST", body: { notes: notes.trim() || undefined, lines: rows.map(({ l, s, rec, rej }) => ({
        delivery_line_id: l.id, quantity_received: rec, quantity_accepted: rec - rej, quantity_rejected: rej,
        discrepancy_type: s.type || (rec < Number(l.quantity_delivered) ? "SHORTAGE" : undefined), discrepancy_notes: s.notes.trim() || undefined,
      })) } });
      await onDone(); setSt({}); setNotes(""); onClose();
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo confirmar."); }
    finally { setBusy(false); }
  }
  const items = Object.entries(DISCREPANCY).map(([value, label]) => ({ value, label }));
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Confirmar recepción · Entrega #{d.delivery_number}</DialogTitle><DialogDescription>Indica cuánto llegó y cuánto rechazas. Si todo llegó bien, confirma tal cual.</DialogDescription></DialogHeader>
        <div className="space-y-3">{rows.map(({ l, s, rej, bad }) => {
          const ol = lines.find((x) => x.id === l.order_line_id);
          return (
            <div key={l.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><p className="font-medium">{ol?.name}</p><p className="text-xs text-muted-foreground">Enviado: {qty(l.quantity_delivered)} {ol?.unit_label}</p></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor={`r-${l.id}`} className="text-xs">Recibido</Label><Input id={`r-${l.id}`} className="h-8" inputMode="decimal" value={s.received} onChange={(e) => set(l, { received: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor={`x-${l.id}`} className="text-xs">De esos, rechazado</Label><Input id={`x-${l.id}`} className="h-8" inputMode="decimal" value={s.rejected} onChange={(e) => set(l, { rejected: e.target.value })} /></div>
              </div>
              {(rej > 0 || num(s.received) < Number(l.quantity_delivered)) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select items={items} value={s.type || null} onValueChange={(v) => set(l, { type: v ?? "" })}>
                    <SelectTrigger className="w-full" aria-label={`Tipo de discrepancia de ${ol?.name}`}><SelectValue placeholder="Tipo de discrepancia" /></SelectTrigger>
                    <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input aria-label={`Notas de ${ol?.name}`} className="h-8" placeholder="Detalle (opcional)" value={s.notes} onChange={(e) => set(l, { notes: e.target.value })} />
                </div>)}
              {bad && <p className="text-xs text-destructive">Revisa las cantidades{rej > 0 && !s.type ? " y elige el tipo de discrepancia" : ""}.</p>}
            </div>);
        })}</div>
        <div className="space-y-1.5"><Label htmlFor="r-notes">Notas de la recepción (opcional)</Label><Textarea id="r-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || rows.some((r) => r.bad)}>{busy ? "Confirmando…" : "Confirmar recepción"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
