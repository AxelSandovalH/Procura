"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, Play, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";
import { RELATIONSHIP_STATUS } from "@/lib/ui/status";

interface Org { id: string; display_name: string }
interface Terms { currency?: string | null; payment_terms?: string | null; quotation_instructions?: string | null; lead_time_days?: number | null }
interface Rel {
  id: string; status: string; position: "BUYER" | "SUPPLIER"; initiated_by_organization_id: string; buyer: Org; supplier: Org; terms: Terms | null; request_message: string | null;
  created_at: string; accepted_at: string | null; suspended_reason: string | null; finalized_reason: string | null; rejected_reason: string | null;
}
interface Share { id: string; show_price: boolean; catalog_items: { id: string; sku: string; name: string } | null; categories: { id: string; name: string } | null }
interface SharedItem { id: string; sku: string; name: string; unit_label: string; list_price_minor: number | string | null; currency: string | null }
type Dlg = "reject" | "suspend" | "finalize" | null;

export default function RelationshipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const session = useSession();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rel = useQuery({ queryKey: ["relationship", id], queryFn: () => api<Rel>(`/relationships/${id}`) });
  const refresh = () => Promise.all(["relationship", "relationships", "shares", "shared-catalog"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  if (rel.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  const r = rel.data;
  if (!r) return <div className="rounded-xl border border-dashed p-12 text-center"><p className="font-medium">Relación no encontrada</p><Link href="/relaciones" className="mt-2 inline-block text-sm underline">Volver</Link></div>;

  const other = r.position === "BUYER" ? r.supplier : r.buyer;
  const st = RELATIONSHIP_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
  const iInitiated = r.initiated_by_organization_id === session.org?.id;
  const canManage = session.can("relationship.manage");
  const canAccept = session.can("relationship.accept") && r.status === "PENDING" && !iInitiated;
  async function simple(path: string) {
    setBusy(true); setError(null);
    try { await api(`/relationships/${id}/${path}`, { method: "POST", body: {} }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }
  const withReason = (path: string) => async (c: string) => { await api(`/relationships/${id}/${path}`, { method: "POST", body: { reason: c || undefined } }); await refresh(); };
  const reason = r.rejected_reason ?? r.suspended_reason ?? r.finalized_reason;

  return (
    <>
      <Link href="/relaciones" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Relaciones</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2"><StatusBadge {...st} /><span className="text-xs text-muted-foreground">{r.position === "BUYER" ? "Es tu proveedor" : "Es tu cliente"}</span></div>
          <h1 className="text-2xl font-semibold tracking-tight">{other.display_name}</h1>
          {r.request_message && <p className="max-w-2xl text-sm text-muted-foreground">“{r.request_message}”</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canAccept && <><Button onClick={() => simple("accept")} disabled={busy}><Check />Aceptar</Button><Button variant="destructive" onClick={() => setDlg("reject")}><X />Rechazar</Button></>}
          {canManage && r.status === "ACTIVE" && <Button variant="outline" onClick={() => setDlg("suspend")}><Ban />Suspender</Button>}
          {canManage && r.status === "SUSPENDED" && <Button variant="outline" onClick={() => simple("reactivate")} disabled={busy}><Play />Reactivar</Button>}
          {canManage && (r.status === "ACTIVE" || r.status === "SUSPENDED") && <Button variant="destructive" onClick={() => setDlg("finalize")}>Finalizar</Button>}
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {r.status === "PENDING" && iInitiated && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">Esperando que {other.display_name} acepte la solicitud.</p>}
      {reason && <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">Motivo: {reason}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {r.position === "SUPPLIER" ? <SharesCard relId={id} active={r.status === "ACTIVE"} /> : <SharedCatalogCard relId={id} active={r.status === "ACTIVE"} />}
        </div>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Detalles</CardTitle></CardHeader><CardContent><dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Comprador</dt><dd>{r.buyer.display_name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Proveedor</dt><dd>{r.supplier.display_name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Solicitada</dt><dd>{dateShort(r.created_at)}</dd></div>
            {r.accepted_at && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Aceptada</dt><dd>{dateShort(r.accepted_at)}</dd></div>}
          </dl></CardContent></Card>
          <TermsCard relId={id} terms={r.terms} editable={canManage && r.status !== "FINALIZED" && r.status !== "REJECTED"} onSaved={refresh} />
        </div>
      </div>

      <ActionDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} title="Rechazar relación" fieldLabel="Motivo" destructive confirmLabel="Rechazar" onConfirm={withReason("reject")} />
      <ActionDialog open={dlg === "suspend"} onOpenChange={(o) => !o && setDlg(null)} title="Suspender relación" description="Mientras esté suspendida no se pueden emitir cotizaciones ni órdenes nuevas." fieldLabel="Motivo" confirmLabel="Suspender" onConfirm={withReason("suspend")} />
      <ActionDialog open={dlg === "finalize"} onOpenChange={(o) => !o && setDlg(null)} title="Finalizar relación" description="Es definitivo. El historial se conserva." fieldLabel="Motivo" destructive confirmLabel="Finalizar" onConfirm={withReason("finalize")} />
    </>
  );
}

function TermsCard({ relId, terms, editable, onSaved }: { relId: string; terms: Terms | null; editable: boolean; onSaved: () => unknown }) {
  const [f, setF] = useState({ currency: "", payment_terms: "", quotation_instructions: "", lead_time_days: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setF({ currency: terms?.currency ?? "", payment_terms: terms?.payment_terms ?? "", quotation_instructions: terms?.quotation_instructions ?? "", lead_time_days: terms?.lead_time_days?.toString() ?? "" }), [terms]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api(`/relationships/${relId}/terms`, { method: "PATCH", body: { currency: f.currency.trim().toUpperCase() || null, payment_terms: f.payment_terms.trim() || null, quotation_instructions: f.quotation_instructions.trim() || null, lead_time_days: f.lead_time_days === "" ? null : Number(f.lead_time_days) } });
      await onSaved(); setMsg("Guardado");
    } catch (er) { setMsg(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return (
    <Card><CardHeader><CardTitle>Términos acordados</CardTitle></CardHeader><CardContent>
      {editable ? (
        <form className="space-y-3" onSubmit={save}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="t-cur">Moneda</Label><Input id="t-cur" maxLength={3} placeholder="MXN" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="t-lt">Entrega (días)</Label><Input id="t-lt" type="number" min={0} value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="t-pay">Condiciones de pago</Label><Input id="t-pay" value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="t-ins">Instrucciones para cotizar</Label><Textarea id="t-ins" rows={3} value={f.quotation_instructions} onChange={(e) => setF({ ...f, quotation_instructions: e.target.value })} /></div>
          <div className="flex items-center gap-3"><Button type="submit" variant="outline" disabled={busy}>Guardar términos</Button>{msg && <span role="status" className="text-xs text-muted-foreground">{msg}</span>}</div>
        </form>
      ) : (
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Moneda</dt><dd>{terms?.currency ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Entrega</dt><dd>{terms?.lead_time_days != null ? `${terms.lead_time_days} días` : "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Pago</dt><dd className="text-right">{terms?.payment_terms ?? "—"}</dd></div>
          {terms?.quotation_instructions && <p className="rounded-lg bg-muted px-3 py-2">{terms.quotation_instructions}</p>}
        </dl>)}
    </CardContent></Card>
  );
}

function SharesCard({ relId, active }: { relId: string; active: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const shares = useQuery({ queryKey: ["shares", relId], queryFn: () => api<{ data: Share[] }>(`/relationships/${relId}/catalog-shares`) });
  const canShare = session.can("catalog.share") && active;
  async function remove(sid: string) { await api(`/relationships/${relId}/catalog-shares/${sid}`, { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["shares", relId] }); }
  const list = shares.data?.data ?? [];
  return (
    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Catálogo que compartes</CardTitle>{canShare && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus />Compartir</Button>}</div></CardHeader>
      <CardContent>
        {shares.isLoading ? <div className="h-12 animate-pulse rounded bg-muted" /> : list.length === 0 ? <p className="text-sm text-muted-foreground">No compartes nada con este cliente. Por defecto tu catálogo es privado.</p> : (
          <ul className="divide-y text-sm">{list.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div><span className="font-medium">{s.catalog_items ? `${s.catalog_items.sku} — ${s.catalog_items.name}` : `Categoría: ${s.categories?.name}`}</span><span className="ml-2 text-xs text-muted-foreground">{s.show_price ? "con precio" : "sin precio"}</span></div>
              {canShare && <Button size="icon-sm" variant="ghost" aria-label="Dejar de compartir" onClick={() => void remove(s.id)}><Trash2 /></Button>}
            </li>))}</ul>)}
      </CardContent>
      <ShareDialog open={open} onOpenChange={setOpen} relId={relId} onDone={() => qc.invalidateQueries({ queryKey: ["shares", relId] })} />
    </Card>
  );
}

function ShareDialog({ open, onOpenChange, relId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; relId: string; onDone: () => unknown }) {
  const items = useQuery({ queryKey: ["catalog-items", ""], queryFn: () => api<{ data: { id: string; sku: string; name: string }[] }>("/catalog/items"), enabled: open });
  const cats = useQuery({ queryKey: ["catalog-categories"], queryFn: () => api<{ data: { id: string; name: string }[] }>("/catalog/categories"), enabled: open });
  const [target, setTarget] = useState<string | null>(null);
  const [showPrice, setShowPrice] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const options = [...(cats.data?.data ?? []).map((c) => ({ value: `c:${c.id}`, label: `Categoría: ${c.name}` })), ...(items.data?.data ?? []).map((i) => ({ value: `i:${i.id}`, label: `${i.sku} — ${i.name}` }))];
  async function go() {
    setBusy(true); setError(null);
    try {
      const [k, v] = target!.split(":");
      await api(`/relationships/${relId}/catalog-shares`, { method: "POST", body: { ...(k === "i" ? { catalog_item_id: v } : { category_id: v }), show_price: showPrice } });
      await onDone(); setTarget(null); setShowPrice(false); onOpenChange(false);
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo compartir."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}><DialogContent>
      <DialogHeader><DialogTitle>Compartir catálogo</DialogTitle><DialogDescription>Elige un artículo o una categoría completa. El cliente solo verá lo que compartas.</DialogDescription></DialogHeader>
      <Select items={options} value={target} onValueChange={(v) => setTarget(v)}>
        <SelectTrigger className="w-full" aria-label="Qué compartir"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />Mostrar precio de lista</label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || !target}>Compartir</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function SharedCatalogCard({ relId, active }: { relId: string; active: boolean }) {
  const session = useSession();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const cat = useQuery({ queryKey: ["shared-catalog", relId, term], queryFn: () => api<{ data: SharedItem[] }>(`/relationships/${relId}/shared-catalog${term ? `?q=${encodeURIComponent(term)}` : ""}`), enabled: active && session.can("shared_catalog.read") });
  if (!active || !session.can("shared_catalog.read")) return null;
  const rows = cat.data?.data ?? [];
  return (
    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Catálogo del proveedor</CardTitle><Input aria-label="Buscar en el catálogo" className="h-8 w-48" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></div></CardHeader>
      <CardContent className="px-0">
        {cat.isLoading ? <div className="mx-4 h-16 animate-pulse rounded bg-muted" /> : rows.length === 0 ? <p className="px-4 text-sm text-muted-foreground">{term ? "Sin coincidencias." : "El proveedor aún no comparte artículos contigo."}</p> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Artículo</TableHead><TableHead>Unidad</TableHead><TableHead className="text-right">Precio de lista</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((i) => <TableRow key={i.id}><TableCell className="font-mono text-xs">{i.sku}</TableCell><TableCell className="font-medium">{i.name}</TableCell><TableCell className="text-muted-foreground">{i.unit_label}</TableCell><TableCell className="text-right tabular-nums">{i.list_price_minor != null ? money(i.list_price_minor, i.currency ?? "MXN") : "—"}</TableCell></TableRow>)}</TableBody>
          </Table></div>)}
      </CardContent>
    </Card>
  );
}
