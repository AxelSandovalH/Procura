"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

interface Customer { id: string; name: string; tax_id: string | null }

/** Cambia (o quita) el cliente de una venta. Escribir un nombre nuevo crea el cliente. Con una factura ligada no se puede cambiar. */
export function ChangeCustomer({ saleId, current, locked, onDone }: { saleId: string; current: { id: string; name: string } | null; locked: boolean; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ data: Customer[] }>("/customers"), enabled: open });
  async function save(clear = false) {
    setBusy(true); setError(null);
    try {
      const typed = name.trim(); let customer_id: string | null = null;
      if (!clear) {
        if (!typed) throw new ApiError(400, "Falta el cliente", "Escribe o elige un cliente.");
        const hit = customers.data?.data.find((c) => c.name.toLowerCase() === typed.toLowerCase());
        customer_id = hit?.id ?? (await api<{ id: string }>("/customers", { body: { name: typed } })).id;
      }
      await api(`/sales/${saleId}`, { method: "PATCH", body: { customer_id } }); await onDone(); setOpen(false);
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo cambiar el cliente."); } finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => { setName(current?.name ?? ""); setError(null); setOpen(true); }}>{current ? "Cambiar cliente" : "Asignar cliente"}</button>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent>
        <DialogHeader><DialogTitle>{current ? "Cambiar cliente" : "Asignar cliente"}</DialogTitle><DialogDescription>{locked ? "Esta venta ya tiene una factura ligada: para cambiar el cliente primero hay que desligar el comprobante." : "Elige un cliente de la lista o escribe un nombre nuevo para crearlo (sus datos fiscales se completan en Relaciones → Clientes)."}</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="cc-name">Cliente</Label><Input id="cc-name" list="cc-customers" maxLength={200} disabled={locked} value={name} onChange={(e) => setName(e.target.value)} /><datalist id="cc-customers">{(customers.data?.data ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {current && <Button variant="outline" disabled={busy || locked} onClick={() => void save(true)}>Quitar cliente</Button>}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={busy || locked || !name.trim()}>{busy ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}
