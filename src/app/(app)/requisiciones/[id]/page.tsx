"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, MessageSquareWarning, Send, Undo2, X, XCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuotationComparison } from "@/components/app/quotation-comparison";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, dateTime, money, qty } from "@/lib/format";
import { PRIORITY, REQUISITION_STATUS } from "@/lib/ui/status";

interface Concept { id: string; line_number: number; name: string; concept_type: string; quantity: string; unit_label: string; estimated_unit_price_minor?: number | string | null; specifications?: unknown }
interface Requisition {
  id: string; folio: string; title: string; description: string | null; status: string; priority: string; version: number; currency: string;
  required_date: string | null; created_at: string; origin_type: string; estimated_total_minor?: number | string; budget_max_minor?: number | string | null;
  concepts: Concept[]; available_actions: string[]; order_id: string | null; cancel_reason: string | null;
}
interface Decision { id: string; decision: string; comment: string | null; decided_at: string }
interface Step { id: string; level: number; status: string; decision_mode: string; approval_decisions: Decision[] }
interface ApprovalRequest { id: string; status: string; requisition_version: number; started_at: string; approval_steps: Step[] }

const DECISION = { APPROVE: "Aprobó", REJECT: "Rechazó", REQUEST_CHANGES: "Pidió cambios" } as Record<string, string>;
const REQ_STATUS = { PENDING: "En curso", APPROVED: "Aprobada", REJECTED: "Rechazada", CHANGES_REQUESTED: "Cambios solicitados", CANCELLED: "Cancelada", SUPERSEDED: "Reemplazada" } as Record<string, string>;

type Dlg = "cancel" | "reject" | "changes" | "approve" | null;

export default function RequisitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const req = useQuery({ queryKey: ["requisition", id], queryFn: () => api<Requisition>(`/requisitions/${id}`) });
  const approvals = useQuery({ queryKey: ["requisition-approvals", id], queryFn: () => api<{ data: ApprovalRequest[] }>(`/requisitions/${id}/approvals`), enabled: req.isSuccess });
  const canDecide = session.can("requisition.approve");
  const pending = useQuery({ queryKey: ["approvals-pending"], queryFn: () => api<{ data: { requisition: { id: string } }[] }>("/approvals/pending"), enabled: canDecide });
  const iCanDecide = !!pending.data?.data.some((p) => p.requisition.id === id);

  const refresh = () => Promise.all(["requisition", "requisition-approvals", "requisitions", "approvals-pending"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/requisitions/${id}/${path}`, { method: "POST", body: body ?? {} }),
    onSuccess: refresh,
    onError: (e) => setActionError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo completar la acción."),
  });
  const run = (path: string, body?: unknown) => { setActionError(null); return act.mutateAsync({ path, body }); };
  async function duplicate() {
    setActionError(null);
    try { const copy = await api<{ id: string }>(`/requisitions/${id}/duplicate`, { method: "POST" }); await refresh(); router.push(`/requisiciones/${copy.id}`); }
    catch (e) { setActionError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo duplicar."); }
  }

  if (req.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (req.error || !req.data) {
    const notFound = req.error instanceof ApiError && req.error.status === 404;
    return <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">{notFound ? "Requisición no encontrada" : "No se pudo cargar"}</p><Link href="/requisiciones" className="mt-2 inline-block text-sm underline">Volver al listado</Link></div>;
  }

  const r = req.data;
  const st = REQUISITION_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
  const pr = PRIORITY[r.priority] ?? { label: r.priority, tone: "neutral" as const };
  const has = (a: string) => r.available_actions.includes(a);
  const showPrices = r.estimated_total_minor !== undefined;

  return (
    <>
      <Link href="/requisiciones" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Requisiciones</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm text-muted-foreground">{r.folio}</span><StatusBadge {...st} /><StatusBadge {...pr} />{r.version > 1 && <span className="text-xs text-muted-foreground">v{r.version}</span>}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          {r.description && <p className="max-w-2xl text-sm text-muted-foreground">{r.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {iCanDecide && (<>
            <Button onClick={() => setDlg("approve")}><Check />Aprobar</Button>
            <Button variant="outline" onClick={() => setDlg("changes")}><MessageSquareWarning />Pedir cambios</Button>
            <Button variant="destructive" onClick={() => setDlg("reject")}><X />Rechazar</Button>
          </>)}
          {has("submit") && <Button onClick={() => run("submit")} disabled={act.isPending}><Send />Enviar a aprobación</Button>}
          {has("withdraw") && <Button variant="outline" onClick={() => run("withdraw")} disabled={act.isPending}><Undo2 />Retirar</Button>}
          {has("close") && <Button variant="outline" onClick={() => run("close")} disabled={act.isPending}><Lock />Cerrar</Button>}
          {has("duplicate") && <Button variant="outline" onClick={duplicate}><Copy />Duplicar</Button>}
          {has("cancel") && <Button variant="destructive" onClick={() => setDlg("cancel")}><XCircle />Cancelar</Button>}
        </div>
      </div>
      {actionError && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{actionError}</p>}
      {r.status === "CANCELLED" && r.cancel_reason && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">Motivo de cancelación: {r.cancel_reason}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Conceptos</CardTitle></CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Cantidad</TableHead>{showPrices && <><TableHead className="text-right">P. unitario est.</TableHead><TableHead className="text-right">Subtotal</TableHead></>}</TableRow></TableHeader>
                <TableBody>{r.concepts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground">{c.line_number}</TableCell><TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.concept_type === "GOOD" ? "Bien" : "Servicio"}</TableCell>
                    <TableCell className="text-right tabular-nums">{qty(c.quantity)} {c.unit_label}</TableCell>
                    {showPrices && <><TableCell className="text-right tabular-nums">{money(c.estimated_unit_price_minor, r.currency)}</TableCell><TableCell className="text-right tabular-nums">{c.estimated_unit_price_minor != null ? money(Number(c.quantity) * Number(c.estimated_unit_price_minor), r.currency) : "—"}</TableCell></>}
                  </TableRow>))}</TableBody>
              </Table></div>
              {showPrices && <div className="flex justify-end gap-8 border-t px-4 pt-3 text-sm"><span className="text-muted-foreground">Total estimado</span><span className="font-semibold tabular-nums">{money(r.estimated_total_minor, r.currency)}</span></div>}
            </CardContent>
          </Card>
          <QuotationComparison requisitionId={r.id} status={r.status} concepts={r.concepts} currency={r.currency} hasOrder={!!r.order_id} />
        </div>

        <div className="space-y-6">
          {r.order_id && <Link href={`/ordenes/${r.order_id}`} className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted">Ver orden generada<ArrowLeft className="size-4 rotate-180" /></Link>}
          <Card>
            <CardHeader><CardTitle>Detalles</CardTitle></CardHeader>
            <CardContent><dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Creada</dt><dd>{dateShort(r.created_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fecha requerida</dt><dd>{dateShort(r.required_date)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Origen</dt><dd>{({ MANUAL: "Manual", API: "API / ERP", PORTAL: "Portal", DUPLICATE: "Duplicada", REORDER: "Reorden", TEMPLATE: "Plantilla", SPLIT: "División" } as Record<string, string>)[r.origin_type] ?? r.origin_type}</dd></div>
              {r.budget_max_minor != null && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Presupuesto máx.</dt><dd className="tabular-nums">{money(r.budget_max_minor, r.currency)}</dd></div>}
            </dl></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Aprobación</CardTitle></CardHeader>
            <CardContent>
              {approvals.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : (approvals.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">{r.status === "DRAFT" ? "Aún no se envía a aprobación." : "Sin flujo de aprobación (aprobada automáticamente)."}</p> : (
                <ol className="space-y-4">{approvals.data!.data.map((ar) => (
                  <li key={ar.id} className="space-y-2">
                    <div className="flex items-center justify-between text-xs"><span className="font-medium">Versión {ar.requisition_version}</span><span className="text-muted-foreground">{REQ_STATUS[ar.status] ?? ar.status}</span></div>
                    <ul className="space-y-2 border-l pl-3">{ar.approval_steps.map((s) => (
                      <li key={s.id} className="text-sm">
                        <p>Nivel {s.level} <span className="text-xs text-muted-foreground">· {s.decision_mode === "ALL" ? "todos deben aprobar" : "basta uno"}</span></p>
                        {s.approval_decisions.length === 0 ? <p className="text-xs text-muted-foreground">{s.status === "PENDING" ? "Esperando decisión" : "—"}</p> : s.approval_decisions.map((d) => <p key={d.id} className="text-xs text-muted-foreground">{DECISION[d.decision] ?? d.decision} · {dateTime(d.decided_at)}{d.comment ? ` — “${d.comment}”` : ""}</p>)}
                      </li>))}</ul>
                  </li>))}</ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ActionDialog open={dlg === "approve"} onOpenChange={(o) => !o && setDlg(null)} title="Aprobar requisición" description={`${r.folio} — ${r.title}`} confirmLabel="Aprobar" onConfirm={(c) => run("approve", { comment: c || undefined })} />
      <ActionDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} title="Rechazar requisición" description="El solicitante verá tu comentario." fieldLabel="Motivo" required destructive confirmLabel="Rechazar" onConfirm={(c) => run("reject", { comment: c })} />
      <ActionDialog open={dlg === "changes"} onOpenChange={(o) => !o && setDlg(null)} title="Pedir cambios" description="Vuelve a borrador para que el solicitante la corrija y la reenvíe." fieldLabel="¿Qué debe cambiar?" required confirmLabel="Pedir cambios" onConfirm={(c) => run("request-changes", { comment: c })} />
      <ActionDialog open={dlg === "cancel"} onOpenChange={(o) => !o && setDlg(null)} title="Cancelar requisición" description="No se elimina: queda registrada como cancelada." fieldLabel="Motivo" required destructive confirmLabel="Cancelar requisición" onConfirm={(c) => run("cancel", { reason: c })} />
    </>
  );
}
