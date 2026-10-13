"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { SAT_REGIMES, SAT_USES } from "@/lib/ui/sat-catalogs";

interface Customer { id: string; name: string; tax_id: string | null; email: string | null; tax_regime_code: string | null; zip_code: string | null; cfdi_use_code: string | null }
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);
const sel = "h-9 w-full rounded-lg border bg-background px-2 text-sm";
const complete = (c: Customer) => !!(c.tax_id && c.tax_regime_code && c.zip_code && c.cfdi_use_code);

/** Clientes a quienes les vendes y les facturas, con los datos fiscales que necesita su CFDI. */
export default function Clientes() {
  const session = useSession(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["customers", "all"], queryFn: () => api<{ data: Customer[] }>("/customers"), enabled: session.can("sale.read") });
  const [edit, setEdit] = useState<Customer | "new" | null>(null);
  if (!session.can("sale.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver los clientes.</p>;
  const rows = q.data?.data ?? [], canManage = session.can("sale.manage");
  return (
    <>
      <PageHeader title="Clientes para facturar" description="A quienes les vendes. Con sus datos fiscales completos, emitirles una factura es un clic."
        actions={canManage ? <Button onClick={() => setEdit("new")}><Plus />Nuevo cliente</Button> : undefined} />
      {q.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><Users className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Aún no tienes clientes</p><p className="mt-1 text-sm text-muted-foreground">Se crean al registrar una venta, o aquí con sus datos fiscales.</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>RFC</TableHead><TableHead>Régimen</TableHead><TableHead>CP fiscal</TableHead><TableHead>Uso de CFDI</TableHead><TableHead>Datos para facturar</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((c) => (
            <TableRow key={c.id} className={canManage ? "cursor-pointer" : ""} onClick={() => canManage && setEdit(c)}>
              <TableCell className="font-medium">{c.name}</TableCell><TableCell className="font-mono text-xs">{c.tax_id ?? "—"}</TableCell><TableCell>{c.tax_regime_code ?? "—"}</TableCell><TableCell>{c.zip_code ?? "—"}</TableCell><TableCell>{c.cfdi_use_code ?? "—"}</TableCell>
              <TableCell>{complete(c) ? <span className="text-emerald-700">Completos</span> : <span className="text-amber-700">Faltan datos</span>}</TableCell>
            </TableRow>))}</TableBody></Table></div>)}
      {edit && <CustomerDialog key={edit === "new" ? "new" : edit.id} customer={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={async () => { await qc.invalidateQueries({ queryKey: ["customers"] }); setEdit(null); }} />}
    </>
  );
}

function CustomerDialog({ customer, onClose, onDone }: { customer: Customer | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ name: customer?.name ?? "", tax_id: customer?.tax_id ?? "", email: customer?.email ?? "", regime: customer?.tax_regime_code ?? "", zip: customer?.zip_code ?? "", use: customer?.cfdi_use_code ?? "G03" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const body = () => ({ name: f.name.trim(), tax_id: f.tax_id.trim() || null, email: f.email.trim() || null, tax_regime_code: f.regime || null, zip_code: f.zip.trim() || null, cfdi_use_code: f.use || null });
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(null); try { await fn(); await onDone(); } catch (e) { setError(err(e, "No se pudo guardar.")); setBusy(false); } }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent>
      <DialogHeader><DialogTitle>{customer ? "Datos del cliente" : "Nuevo cliente"}</DialogTitle><DialogDescription>Tal como están en su constancia de situación fiscal: el nombre sin «S.A. de C.V.» ni otros regímenes societarios.</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(() => customer ? api(`/customers/${customer.id}`, { method: "PATCH", body: body() }) : api("/customers", { body: body() })); }}>
        <div className="space-y-1"><Label htmlFor="c-name">Nombre o razón social *</Label><Input id="c-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="c-rfc">RFC</Label><Input id="c-rfc" maxLength={13} value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1"><Label htmlFor="c-zip">Código postal fiscal</Label><Input id="c-zip" inputMode="numeric" maxLength={5} value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value.replace(/\D/g, "") })} /></div>
          <div className="col-span-2 space-y-1"><Label htmlFor="c-reg">Régimen fiscal</Label><select id="c-reg" className={sel} value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}><option value="">Elige…</option>{SAT_REGIMES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="c-use">Uso de CFDI</Label><select id="c-use" className={sel} value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })}>{SAT_USES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="c-mail">Correo</Label><Input id="c-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {customer && <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => void run(() => api(`/customers/${customer.id}`, { method: "PATCH", body: { archived: true } }))}>Archivar</Button>}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !f.name.trim()}>Guardar</Button>
        </DialogFooter>
      </form>
    </DialogContent></Dialog>
  );
}
