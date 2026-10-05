"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Relationship { id: string; supplier: { id: string; display_name: string } }
interface Line { name: string; quantity: string; unit: string }
const blank = (): Line => ({ name: "", quantity: "1", unit: "PZA" });

/** Compra rápida: qué necesitas + a quién pedirle, en una sola pantalla. Crea, envía y pide cotización de una vez. */
export default function ComprarPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { org, can } = useSession();
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [date, setDate] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = todos
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const rels = useQuery({ queryKey: ["relationships", "BUYER", "ACTIVE"], queryFn: () => api<{ data: Relationship[] }>("/relationships?position=BUYER&status=ACTIVE"), enabled: can("relationship.read") });
  const suppliers = rels.data?.data ?? [];
  const selected = suppliers.filter((r) => !picked || picked.has(r.supplier.id)).map((r) => r.supplier.id);
  const canQuote = can("rfq.issue");
  const valid = title.trim() && lines.every((l) => l.name.trim() && Number(l.quantity) > 0 && l.unit.trim());
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const toggle = (id: string) => setPicked((cur) => { const s = new Set(cur ?? suppliers.map((r) => r.supplier.id)); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ requisition: { id: string } }>("/purchases", { body: {
        title: title.trim(), currency: org?.base_currency ?? "MXN", required_date: date || undefined,
        supplier_organization_ids: canQuote ? selected : [],
        concepts: lines.map((l) => ({ concept_type: "GOOD", source: "FREE", name: l.name.trim(), quantity: Number(l.quantity), unit_label: l.unit.trim() })),
      } });
      await Promise.all(["requisitions", "onboarding-status"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      router.push(`/requisiciones/${r.requisition.id}`);
    } catch (er) { setError(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo enviar."); setBusy(false); }
  }

  if (!can("requisition.create")) return <p className="text-sm text-muted-foreground">No tienes permiso para crear solicitudes de compra.</p>;
  return (
    <>
      <PageHeader title="Comprar" description="Dinos qué necesitas y a quién pedirle. Nosotros pedimos las cotizaciones; tú solo eliges." />
      <form onSubmit={submit} className="max-w-3xl space-y-6">
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="space-y-1.5"><Label htmlFor="c-title">¿Qué necesitas? *</Label><Input id="c-title" required maxLength={200} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Laptops y monitores para operaciones" /></div>

        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Cantidades</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] items-center gap-2">
              <Input aria-label={`Concepto ${i + 1}`} required maxLength={200} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Producto o servicio" />
              <Input aria-label="Cantidad" type="number" min={0.01} step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <Input aria-label="Unidad" maxLength={40} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar concepto" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus />Agregar otro</Button>
        </fieldset>

        <div className="space-y-1.5"><Label htmlFor="c-date">Fecha en que lo necesitas <span className="text-muted-foreground">(opcional)</span></Label><Input id="c-date" type="date" className="w-48" value={date} onChange={(e) => setDate(e.target.value)} /></div>

        {canQuote ? (
          <fieldset className="space-y-2"><legend className="text-sm font-medium">¿A quién se le pide cotización?</legend>
            {rels.isLoading ? <div className="h-9 animate-pulse rounded bg-muted" /> : suppliers.length === 0
              ? <p className="text-sm text-muted-foreground">Aún no tienes proveedores. <Link href="/relaciones" className="underline">Agrega uno</Link> o envía la solicitud y se queda «por cotizar».</p>
              : <div className="flex flex-wrap gap-2">{suppliers.map((r) => { const on = selected.includes(r.supplier.id); return (
                <label key={r.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", on ? "border-foreground bg-muted" : "text-muted-foreground")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.supplier.id)} />{r.supplier.display_name}</label>); })}</div>}
          </fieldset>
        ) : <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Compras recibirá tu solicitud y pedirá las cotizaciones.</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !valid || (canQuote && suppliers.length > 0 && selected.length === 0)}><Send />{canQuote && selected.length > 0 ? "Pedir cotizaciones" : "Enviar solicitud"}</Button>
          <Link href="/requisiciones/nueva" className="text-sm text-muted-foreground underline">Necesito más detalle (formulario completo)</Link>
        </div>
      </form>
    </>
  );
}
