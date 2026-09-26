"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money, qty } from "@/lib/format";
import { QUOTATION_STATUS, RFQ_STATUS } from "@/lib/ui/status";

interface QLine { id: string; requisition_concept_id: string | null; line_kind: string; name: string; quantity: string; unit_label: string; unit_price_minor: number | string; line_total_minor: number | string; lead_time_days: number | null }
interface Quotation {
  id: string; quotation_number: string; version: number; status: string; currency: string; subtotal_minor: number | string; tax_minor: number | string; total_minor: number | string;
  valid_until: string | null; lead_time_days: number | null; supplier: { id: string; display_name: string }; rfq: { id: string; rfq_number: string }; lines: QLine[];
}
interface Rfq { id: string; rfq_number: string; status: string; due_date: string | null; organizations_quotation_requests_supplier_organization_idToorganizations: { display_name: string } }
interface Concept { id: string; line_number: number; name: string; quantity: string; unit_label: string }
interface Relationship { id: string; supplier: { id: string; display_name: string } }

const HIDDEN = ["DRAFT", "SUPERSEDED", "WITHDRAWN"];

export function QuotationComparison({ requisitionId, status, concepts, currency, hasOrder }: { requisitionId: string; status: string; concepts: Concept[]; currency: string; hasOrder: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reject, setReject] = useState<Quotation | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const canIssue = session.can("rfq.issue");
  const canAccept = session.can("quotation.accept");
  const sourcing = ["APPROVED", "SENT", "IN_PROCESS", "RESOLVED", "CLOSED"].includes(status);

  const quotations = useQuery({ queryKey: ["req-quotations", requisitionId], queryFn: () => api<{ data: Quotation[] }>(`/requisitions/${requisitionId}/quotations`), enabled: sourcing && session.can("quotation.read") });
  const rfqs = useQuery({ queryKey: ["req-rfqs", requisitionId], queryFn: () => api<{ data: Rfq[] }>(`/requisitions/${requisitionId}/rfqs`), enabled: sourcing && canIssue });
  const refresh = () => Promise.all(["req-quotations", "req-rfqs", "requisition", "orders"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const accept = useMutation({
    mutationFn: (id: string) => api<{ order: { id: string } }>(`/quotations/${id}/accept`, { method: "POST", body: {} }),
    onSuccess: refresh, onError: (e) => setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo aceptar."),
  });

  if (!sourcing) return null;
  const list = (quotations.data?.data ?? []).filter((q) => !HIDDEN.includes(q.status));
  const canDecide = canAccept && !hasOrder;

  // Menor precio unitario por concepto (solo entre cotizaciones vivas): se resalta, no se decide por el usuario.
  const best = new Map<string, number>();
  for (const q of list) for (const l of q.lines) if (l.requisition_concept_id && l.line_kind !== "DECLINED") {
    const p = Number(l.unit_price_minor); const cur = best.get(l.requisition_concept_id);
    if (cur === undefined || p < cur) best.set(l.requisition_concept_id, p);
  }
  const extras = list.some((q) => q.lines.some((l) => !l.requisition_concept_id));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2"><CardTitle>Cotizaciones</CardTitle>
        {canIssue && !hasOrder && ["APPROVED", "SENT"].includes(status) && <Button size="sm" variant="outline" onClick={() => setIssueOpen(true)}><Send />Solicitar cotización</Button>}</div>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {error && <p role="alert" className="mx-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        {(rfqs.data?.data.length ?? 0) > 0 && (
          <ul className="flex flex-wrap gap-2 px-4 text-xs">{rfqs.data!.data.map((r) => {
            const st = RFQ_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
            return <li key={r.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1"><Link href={`/solicitudes/${r.id}`} className="font-mono hover:underline">{r.rfq_number}</Link><span>{r.organizations_quotation_requests_supplier_organization_idToorganizations.display_name}</span><StatusBadge {...st} /></li>;
          })}</ul>
        )}
        {quotations.isLoading ? <div className="mx-4 h-24 animate-pulse rounded bg-muted" /> : list.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">{(rfqs.data?.data.length ?? 0) > 0 ? "Aún no hay cotizaciones enviadas por los proveedores." : "Todavía no se ha solicitado cotización."}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="min-w-40">Concepto</TableHead>
                {list.map((q) => <TableHead key={q.id} className="min-w-44 text-right">
                  <div className="font-medium text-foreground">{q.supplier.display_name}</div>
                  <div className="flex items-center justify-end gap-1.5 font-normal"><Link href={`/cotizaciones/${q.id}`} className="font-mono text-xs hover:underline">{q.quotation_number}</Link>{q.version > 1 && <span className="text-xs">v{q.version}</span>}</div>
                </TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {concepts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{qty(c.quantity)} {c.unit_label}</div></TableCell>
                    {list.map((q) => {
                      const l = q.lines.find((x) => x.requisition_concept_id === c.id);
                      if (!l) return <TableCell key={q.id} className="text-right text-muted-foreground">—</TableCell>;
                      if (l.line_kind === "DECLINED") return <TableCell key={q.id} className="text-right text-muted-foreground">No cotiza</TableCell>;
                      const isBest = best.get(c.id) === Number(l.unit_price_minor) && list.length > 1;
                      return <TableCell key={q.id} className={`text-right tabular-nums ${isBest ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}>
                        <div className={isBest ? "font-semibold" : ""}>{money(l.unit_price_minor, q.currency)}</div>
                        <div className="text-xs text-muted-foreground">{qty(l.quantity)} {l.unit_label} · {money(l.line_total_minor, q.currency)}</div>
                        {l.line_kind !== "AS_REQUESTED" && <div className="text-xs text-amber-700 dark:text-amber-400">{l.line_kind === "SUBSTITUTE" ? `Sustituto: ${l.name}` : l.line_kind === "ALTERNATIVE_QUANTITY" ? "Cantidad alternativa" : l.name}</div>}
                      </TableCell>;
                    })}
                  </TableRow>))}
                {extras && <TableRow><TableCell className="align-top"><div className="font-medium">Adicionales</div><div className="text-xs text-muted-foreground">Ofrecidos por el proveedor</div></TableCell>
                  {list.map((q) => <TableCell key={q.id} className="text-right text-xs">{q.lines.filter((l) => !l.requisition_concept_id).map((l) => <div key={l.id}>{l.name} · {money(l.line_total_minor, q.currency)}</div>)}</TableCell>)}</TableRow>}
                <TableRow className="border-t-2"><TableCell className="text-muted-foreground">Impuestos</TableCell>{list.map((q) => <TableCell key={q.id} className="text-right tabular-nums">{money(q.tax_minor, q.currency)}</TableCell>)}</TableRow>
                <TableRow><TableCell className="font-medium">Total</TableCell>{list.map((q) => <TableCell key={q.id} className="text-right text-base font-semibold tabular-nums">{money(q.total_minor, q.currency)}</TableCell>)}</TableRow>
                <TableRow><TableCell className="text-muted-foreground">Entrega</TableCell>{list.map((q) => <TableCell key={q.id} className="text-right">{q.lead_time_days != null ? `${q.lead_time_days} días` : "—"}</TableCell>)}</TableRow>
                <TableRow><TableCell className="text-muted-foreground">Vigencia</TableCell>{list.map((q) => <TableCell key={q.id} className="text-right">{dateShort(q.valid_until)}</TableCell>)}</TableRow>
                <TableRow><TableCell className="text-muted-foreground">Estado</TableCell>{list.map((q) => <TableCell key={q.id} className="text-right"><StatusBadge {...(QUOTATION_STATUS[q.status] ?? { label: q.status, tone: "neutral" as const })} /></TableCell>)}</TableRow>
                {canDecide && <TableRow><TableCell />{list.map((q) => <TableCell key={q.id} className="text-right">
                  {(q.status === "SUBMITTED" || q.status === "NOT_SELECTED") && <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => { setError(null); accept.mutate(q.id); }} disabled={accept.isPending}><Check />Aceptar</Button>
                    <Button size="sm" variant="outline" onClick={() => setReject(q)}><X />Rechazar</Button>
                  </div>}
                </TableCell>)}</TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="px-4 text-xs text-muted-foreground">Al aceptar una cotización se crea la orden con esas líneas y precios. Los precios más bajos por concepto se resaltan; la decisión es tuya.</p>
      </CardContent>

      <ActionDialog open={!!reject} onOpenChange={(o) => !o && setReject(null)} title="Rechazar cotización" description={reject ? `${reject.quotation_number} — ${reject.supplier.display_name}` : undefined} fieldLabel="Motivo" required destructive confirmLabel="Rechazar"
        onConfirm={async (c) => { await api(`/quotations/${reject!.id}/reject`, { method: "POST", body: { reason: c } }); await refresh(); }} />
      <IssueRfqDialog open={issueOpen} onOpenChange={setIssueOpen} requisitionId={requisitionId} currency={currency} onDone={refresh} />
    </Card>
  );
}

function IssueRfqDialog({ open, onOpenChange, requisitionId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; requisitionId: string; currency: string; onDone: () => unknown }) {
  const rels = useQuery({ queryKey: ["relationships", "BUYER", "ACTIVE"], queryFn: () => api<{ data: Relationship[] }>("/relationships?position=BUYER&status=ACTIVE"), enabled: open });
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function go() {
    setBusy(true); setError(null);
    try {
      await api(`/requisitions/${requisitionId}/rfqs`, { method: "POST", body: { supplier_organization_ids: picked, due_date: due || undefined, message: message.trim() || undefined } });
      await onDone(); setPicked([]); setDue(""); setMessage(""); onOpenChange(false);
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo enviar."); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Solicitar cotización</DialogTitle><DialogDescription>Se envía una solicitud por proveedor con los conceptos de la requisición. Tu presupuesto y precios estimados no se comparten.</DialogDescription></DialogHeader>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Proveedores</legend>
          {rels.isLoading ? <div className="h-10 animate-pulse rounded bg-muted" /> : (rels.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No tienes proveedores con relación activa.</p> :
            rels.data!.data.map((r) => <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" checked={picked.includes(r.supplier.id)} onChange={() => toggle(r.supplier.id)} />{r.supplier.display_name}</label>)}
        </fieldset>
        <div className="space-y-1.5"><Label htmlFor="rfq-due">Responder antes de (opcional)</Label><Input id="rfq-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rfq-msg">Mensaje (opcional)</Label><Textarea id="rfq-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || picked.length === 0}>{busy ? "Enviando…" : `Enviar a ${picked.length || ""} proveedor${picked.length === 1 ? "" : "es"}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
