"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";

interface Txn { id: string; posted_at: string; description: string; amount_minor: number; currency: string }

/** Un abono sin venta registrada: crea la venta (o ingreso) ya cobrada con el importe y la fecha del banco y la concilia. Un cliente nuevo se crea al escribir su nombre. */
export function SaleFromDeposit({ txn, onClose, onDone }: { txn: Txn | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [desc, setDesc] = useState(""); const [cust, setCust] = useState(""); const [tax, setTax] = useState<0 | 8 | 16>(16); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: { id: string; name: string }[] }>("/customers"), enabled: !!txn });
  async function save() {
    if (!txn) return; setBusy(true); setError(null);
    try {
      const name = cust.trim(); let customer_id: string | null = null;
      if (name) customer_id = customers.data?.data.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? (await api<{ id: string }>("/customers", { body: { name } })).id;
      await api(`/bank/transactions/${txn.id}/sale`, { body: { description: desc.trim(), customer_id, tax_percent: tax } });
      await onDone(); setDesc(""); setCust(""); setTax(16); onClose();
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo crear la venta."); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!txn} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}><DialogContent>
      <DialogHeader><DialogTitle>Crear venta o ingreso desde el abono</DialogTitle><DialogDescription>{txn ? `${money(txn.amount_minor, txn.currency)} · ${dateShort(txn.posted_at)}. Se crea ya cobrada y conciliada, con el importe y la fecha del banco.` : ""}</DialogDescription></DialogHeader>
      <div className="space-y-4 text-sm">
        {txn && <p className="break-words rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{txn.description}</p>}
        <div className="space-y-1.5"><Label htmlFor="sd-desc">Descripción *</Label><Input id="sd-desc" maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. Pago de Stripe, anticipo de Sergio" /></div>
        <div className="space-y-1.5"><Label htmlFor="sd-cust">Cliente (opcional)</Label><Input id="sd-cust" list="sd-customers" maxLength={200} value={cust} onChange={(e) => setCust(e.target.value)} /><datalist id="sd-customers">{(customers.data?.data ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist></div>
        <fieldset className="space-y-1.5"><legend className="mb-1 font-medium">El abono…</legend>
          {([[16, "Ya incluye IVA de 16%"], [8, "Ya incluye IVA de 8% (región fronteriza)"], [0, "No lleva IVA (p. ej. un pago de la plataforma o un reembolso)"]] as const).map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="radio" name="sd-tax" checked={tax === v} onChange={() => setTax(v)} />{l}</label>)}</fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={() => void save()} disabled={busy || !desc.trim()}>{busy ? "Creando…" : "Crear venta"}</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}
