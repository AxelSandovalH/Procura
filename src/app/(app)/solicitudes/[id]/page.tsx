"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { CollaborationPanel } from "@/components/app/collaboration-panel";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money, qty } from "@/lib/format";
import { QUOTATION_STATUS, RFQ_STATUS } from "@/lib/ui/status";

interface Line { id: string; line_number: number; name: string; description: string | null; quantity: string; unit_label: string }
interface Rfq { id: string; rfq_number: string; status: string; due_date: string | null; required_date: string | null; message: string | null; perspective: "BUYER" | "SUPPLIER"; requisition_id?: string; buyer: { display_name: string }; supplier: { display_name: string }; lines: Line[]; created_at: string }
interface Quotation { id: string; quotation_number: string; version: number; status: string; currency: string; total_minor: number | string; valid_until: string | null }

export default function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const [dlg, setDlg] = useState<"decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rfq = useQuery({ queryKey: ["rfq", id], queryFn: () => api<Rfq>(`/rfqs/${id}`) });
  const quotes = useQuery({ queryKey: ["rfq-quotations", id], queryFn: () => api<{ data: Quotation[] }>(`/quotations?rfq_id=${id}`), enabled: rfq.isSuccess });
  const refresh = () => Promise.all(["rfq", "rfqs", "rfq-quotations", "req-rfqs"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  if (rfq.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (rfq.error || !rfq.data) return <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Solicitud no encontrada</p><Link href="/solicitudes" className="mt-2 inline-block text-sm underline">Volver</Link></div>;

  const r = rfq.data;
  const isSupplier = r.perspective === "SUPPLIER";
  const open = ["SENT", "VIEWED", "QUOTED"].includes(r.status);
  const st = RFQ_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
  const canQuote = isSupplier && open && session.can("quotation.submit");
  const hasDraft = quotes.data?.data.some((q) => q.status === "DRAFT");

  async function startQuotation() {
    setBusy(true); setError(null);
    try { const q = await api<{ id: string }>(`/rfqs/${id}/quotations`, { method: "POST", body: {} }); await refresh(); router.push(`/cotizaciones/${q.id}`); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo crear la cotización."); setBusy(false); }
  }
  async function withdraw() {
    setBusy(true); setError(null);
    try { await api(`/rfqs/${id}/withdraw`, { method: "POST", body: {} }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo retirar."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Link href="/solicitudes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Solicitudes</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2"><span className="font-mono text-sm text-muted-foreground">{r.rfq_number}</span><StatusBadge {...st} /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{isSupplier ? `Solicitud de ${r.buyer.display_name}` : `Solicitud a ${r.supplier.display_name}`}</h1>
          {r.message && <p className="max-w-2xl text-sm text-muted-foreground">{r.message}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canQuote && (hasDraft ? null : <Button onClick={startQuotation} disabled={busy}><FilePlus2 />{quotes.data?.data.length ? "Nueva versión de cotización" : "Cotizar"}</Button>)}
          {isSupplier && ["SENT", "VIEWED"].includes(r.status) && session.can("rfq.decline") && <Button variant="outline" onClick={() => setDlg("decline")}><XCircle />Declinar</Button>}
          {!isSupplier && open && session.can("rfq.issue") && <Button variant="outline" onClick={withdraw} disabled={busy}><Undo2 />Retirar</Button>}
          {!isSupplier && r.requisition_id && <Link href={`/requisiciones/${r.requisition_id}`} className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm hover:bg-muted">Ver requisición</Link>}
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><CardTitle>Lo que se solicita</CardTitle></CardHeader>
          <CardContent className="px-0"><div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Concepto</TableHead><TableHead className="text-right">Cantidad</TableHead></TableRow></TableHeader>
            <TableBody>{r.lines.map((l) => <TableRow key={l.id}><TableCell className="text-muted-foreground">{l.line_number}</TableCell><TableCell><div className="font-medium">{l.name}</div>{l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}</TableCell><TableCell className="text-right tabular-nums">{qty(l.quantity)} {l.unit_label}</TableCell></TableRow>)}</TableBody>
          </Table></div></CardContent>
        </Card>
        <div className="min-w-0 space-y-6">
          <Card><CardHeader><CardTitle>Detalles</CardTitle></CardHeader><CardContent><dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Comprador</dt><dd>{r.buyer.display_name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Proveedor</dt><dd>{r.supplier.display_name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Responder antes de</dt><dd>{dateShort(r.due_date)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fecha requerida</dt><dd>{dateShort(r.required_date)}</dd></div>
          </dl></CardContent></Card>
          <Card><CardHeader><CardTitle>Cotizaciones</CardTitle></CardHeader><CardContent>
            {(quotes.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">{isSupplier ? "Aún no cotizas esta solicitud." : "Sin cotizaciones."}</p> :
              <ul className="space-y-2">{quotes.data!.data.map((q) => <li key={q.id}><Link href={`/cotizaciones/${q.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                <span><span className="font-mono">{q.quotation_number}</span>{q.version > 1 && <span className="ml-1 text-xs text-muted-foreground">v{q.version}</span>}<span className="block tabular-nums text-muted-foreground">{money(q.total_minor, q.currency)}</span></span>
                <StatusBadge {...(QUOTATION_STATUS[q.status] ?? { label: q.status, tone: "neutral" as const })} /></Link></li>)}</ul>}
          </CardContent></Card>
        </div>
      </div>
      <div className="mt-6"><CollaborationPanel anchorType="RFQ" anchorId={r.id} counterpartName={isSupplier ? r.buyer.display_name : r.supplier.display_name} /></div>

      <ActionDialog open={dlg === "decline"} onOpenChange={(o) => !o && setDlg(null)} title="Declinar solicitud" description="El comprador verá tu motivo." fieldLabel="Motivo" required destructive confirmLabel="Declinar"
        onConfirm={async (c) => { await api(`/rfqs/${id}/decline`, { method: "POST", body: { reason: c } }); await refresh(); }} />
    </>
  );
}
