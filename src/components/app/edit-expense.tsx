"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { money, toMinor } from "@/lib/format";

interface Editable { id: string; spent_at: string; description: string; category: string | null; amount_minor: number | string; currency: string; supplier_name: string | null; paid_minor?: number | string; documented_minor?: number | string }

/** Corrige fecha, monto, descripción, categoría o proveedor de un gasto. El monto no puede quedar por debajo de lo ya pagado ni de lo ya documentado con CFDI. */
export function EditExpenseButton({ expense, onDone }: { expense: Editable; onDone: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const init = () => ({ date: expense.spent_at.slice(0, 10), amount: (Number(expense.amount_minor) / 100).toFixed(2), description: expense.description, category: expense.category ?? "", supplier: expense.supplier_name ?? "" });
  const [open, setOpen] = useState(false); const [f, setF] = useState(init); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const floor = Math.max(Number(expense.paid_minor ?? 0), Number(expense.documented_minor ?? 0));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.description.trim() && Number(f.amount) > 0;
  async function save() {
    setBusy(true); setError(null);
    try {
      await api(`/expenses/${expense.id}`, { method: "PATCH", body: { spent_at: f.date, amount_minor: toMinor(f.amount), description: f.description.trim(), category: f.category.trim() || null, supplier_name: f.supplier.trim() || null } });
      await Promise.all([onDone(), qc.invalidateQueries({ queryKey: ["expense", expense.id] }), qc.invalidateQueries({ queryKey: ["expenses"] }), qc.invalidateQueries({ queryKey: ["finance"] })]); setOpen(false);
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo guardar."); } finally { setBusy(false); }
  }
  return (
    <>
      <Button variant="outline" onClick={() => { setF(init()); setError(null); setOpen(true); }}><Pencil />Editar</Button>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent>
        <DialogHeader><DialogTitle>Editar gasto</DialogTitle><DialogDescription>{floor > 0 ? `El monto no puede ser menor a ${money(floor, expense.currency)} (lo ya pagado o documentado con CFDI).` : "Corrige los datos del gasto."} La moneda ({expense.currency}) no se cambia.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1.5"><Label htmlFor="ee-date">Fecha *</Label><Input id="ee-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="ee-amt">Monto ({expense.currency}) *</Label><Input id="ee-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label htmlFor="ee-desc">Descripción *</Label><Input id="ee-desc" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="ee-sup">Proveedor</Label><Input id="ee-sup" maxLength={200} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="ee-cat">Categoría</Label><Input id="ee-cat" maxLength={80} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button onClick={() => void save()} disabled={busy || !valid}>{busy ? "Guardando…" : "Guardar"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}
