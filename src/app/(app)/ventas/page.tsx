"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ImportSalesButton } from "@/components/app/import-sales";
import { StatusBadge } from "@/components/app/status-badge";
import { apiErr } from "@/components/app/finance-sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { dateShort, money, toMinor } from "@/lib/format";
import { COLLECTION_STATUS, INVOICING_STATUS, PAYMENT_METHOD } from "@/lib/ui/status";

interface Sale { id: string; folio: string; sold_at: string; description: string; currency: string; total_minor: number | string; collected_minor: number | string; collection_status: string; invoicing_status: string; customer_name: string | null }
interface Customer { id: string; name: string }
interface Line { description: string; quantity: string; price: string; discount: string; tax: string }
const blank = (): Line => ({ description: "", quantity: "1", price: "", discount: "", tax: "16" });
const sel = "h-9 rounded-lg border bg-background px-2 text-sm";

export default function VentasPage() {
  const session = useSession();
  const [f, setF] = useState({ from: "", to: "", collection: "", invoicing: "", q: "" });
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams(Object.entries({ from: f.from, to: f.to, collection_status: f.collection, invoicing_status: f.invoicing, q: f.q }).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ["sales", qs], queryFn: () => api<{ data: Sale[] }>(`/sales${qs ? `?${qs}` : ""}`), enabled: session.can("sale.read") });
  if (!session.can("sale.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver ventas.</p>;
  const rows = list.data?.data ?? [];
  const filtered = !!qs;
  return (
    <>
      <PageHeader title="Ventas" description="Ingresos de tu organización. Una venta puede existir antes de facturarse y de cobrarse."
        actions={session.can("sale.manage") ? <div className="flex gap-2"><ImportSalesButton /><Button onClick={() => setCreating(true)}><Plus />Registrar venta</Button></div> : undefined} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Buscar" className="pl-8" placeholder="Folio o descripción" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <Input aria-label="Desde" type="date" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input aria-label="Hasta" type="date" className="w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <select aria-label="Estado de cobro" className={sel} value={f.collection} onChange={(e) => setF({ ...f, collection: e.target.value })}><option value="">Todos los cobros</option>{Object.entries(COLLECTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select aria-label="Estado de facturación" className={sel} value={f.invoicing} onChange={(e) => setF({ ...f, invoicing: e.target.value })}><option value="">Toda la facturación</option>{Object.entries(INVOICING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        {filtered && <Button variant="ghost" onClick={() => setF({ from: "", to: "", collection: "", invoicing: "", q: "" })}>Limpiar</Button>}
      </div>
      {list.error ? <p className="text-sm text-destructive">No se pudieron cargar las ventas.</p> : list.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><TrendingUp className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">{filtered ? "Ninguna venta coincide con el filtro" : "Aún no hay ventas"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{filtered ? "Prueba con otros filtros." : "Registra una venta; luego puedes cobrarla y ligarla a su factura."}</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Cobro</TableHead><TableHead>Facturación</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell><Link href={`/ventas/${s.id}`} className="font-mono text-sm hover:underline">{s.folio}</Link></TableCell>
              <TableCell>{dateShort(s.sold_at)}</TableCell><TableCell className="font-medium">{s.description}</TableCell><TableCell className="text-muted-foreground">{s.customer_name ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{money(s.total_minor, s.currency)}</TableCell>
              <TableCell><StatusBadge {...(COLLECTION_STATUS[s.collection_status] ?? { label: s.collection_status, tone: "neutral" as const })} /></TableCell>
              <TableCell><StatusBadge {...(INVOICING_STATUS[s.invoicing_status] ?? { label: s.invoicing_status, tone: "neutral" as const })} /></TableCell>
            </TableRow>))}</TableBody>
        </Table></div>)}
      <NewSale open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewSale({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { org, can } = useSession(); const router = useRouter(); const qc = useQueryClient();
  const currency = org?.base_currency ?? "MXN";
  const [f, setF] = useState({ sold_at: new Date().toISOString().slice(0, 10), description: "", customer: "", method: "CASH", collect: false, notes: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: Customer[] }>("/customers"), enabled: open });
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const calc = lines.reduce((a, l) => { const g = Math.round((Number(l.quantity) || 0) * toMinor(l.price || "0")); const d = toMinor(l.discount || "0"); const t = Math.round((g - d) * (Number(l.tax) || 0) / 100); return { sub: a.sub + g, disc: a.disc + d, tax: a.tax + t }; }, { sub: 0, disc: 0, tax: 0 });
  const total = calc.sub - calc.disc + calc.tax;
  const valid = f.description.trim() && lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.price.trim());
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      let customer_id: string | undefined;
      const name = f.customer.trim();
      if (name) { const hit = customers.data?.data.find((c) => c.name.toLowerCase() === name.toLowerCase()); customer_id = hit?.id ?? (await api<{ id: string }>("/customers", { body: { name } })).id; }
      const sale = await api<{ id: string }>("/sales", { body: {
        sold_at: f.sold_at, description: f.description.trim(), currency, customer_id, payment_method: f.method, notes: f.notes.trim() || undefined, collect_now: f.collect && can("payment.manage"),
        lines: lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unit_price_minor: toMinor(l.price), discount_minor: toMinor(l.discount || "0"), tax_rate: (Number(l.tax) || 0) / 100 })),
      } });
      await Promise.all(["sales", "customers", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onOpenChange(false); router.push(`/ventas/${sale.id}`);
    } catch (er) { setError(apiErr(er, "No se pudo registrar la venta.")); setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Registrar venta</DialogTitle><DialogDescription>No necesitas facturarla ahora: puedes ligar su CFDI cuando exista.</DialogDescription></DialogHeader>
      <form onSubmit={go} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="v-date">Fecha *</Label><Input id="v-date" type="date" required value={f.sold_at} onChange={(e) => setF({ ...f, sold_at: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="v-cust">Cliente (opcional)</Label><Input id="v-cust" list="v-customers" maxLength={200} value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /><datalist id="v-customers">{(customers.data?.data ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist></div>
          <div className="col-span-2 space-y-1.5"><Label htmlFor="v-desc">Descripción *</Label><Input id="v-desc" required maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej. Servicio de comida del 6 de octubre" /></div>
        </div>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Conceptos</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_4rem_5.5rem_5rem_4rem_auto] items-center gap-1.5">
              <Input aria-label={`Concepto ${i + 1}`} placeholder="Concepto" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              <Input aria-label="Cantidad" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <Input aria-label="Precio unitario" inputMode="decimal" placeholder="Precio" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
              <Input aria-label="Descuento" inputMode="decimal" placeholder="Desc." value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} />
              <Input aria-label="IVA %" inputMode="decimal" value={l.tax} onChange={(e) => setLine(i, { tax: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" aria-label="Quitar concepto" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>))}
          <p className="text-xs text-muted-foreground">Cantidad · precio unitario · descuento · IVA (%)</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}><Plus />Agregar concepto</Button>
        </fieldset>
        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(calc.sub, currency)}</dd></div>
          {calc.disc > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Descuentos</dt><dd className="tabular-nums">−{money(calc.disc, currency)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted-foreground">Impuestos</dt><dd className="tabular-nums">{money(calc.tax, currency)}</dd></div>
          <div className="flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(total, currency)}</dd></div>
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="v-m">Método de pago</Label><select id="v-m" className={`${sel} w-full`} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {can("payment.manage") && <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.collect} onChange={(e) => setF({ ...f, collect: e.target.checked })} />Ya está cobrada (cobro total hoy)</label>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !valid}>Registrar venta</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  );
}
