"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { money, toMinor } from "@/lib/format";
import { PRIORITY } from "@/lib/ui/status";

interface Line { name: string; type: "GOOD" | "SERVICE"; quantity: string; unit: string; price: string }
const blank = (): Line => ({ name: "", type: "GOOD", quantity: "1", unit: "PZA", price: "" });

function NuevaRequisicionForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const directedTo = /^[0-9a-f-]{36}$/i.test(sp.get("proveedor") ?? "") ? sp.get("proveedor") : null;
  const directedName = sp.get("nombre") ?? "el proveedor";
  const qc = useQueryClient();
  const { org, can } = useSession();
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<{ data: { id: string; code: string; name: string }[] }>("/catalog/units"), staleTime: 300_000 });
  const [f, setF] = useState({ title: "", description: "", priority: "NORMAL", required_date: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const currency = org?.base_currency ?? "MXN";

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((acc, l) => acc + toMinor(l.price || "0") * (Number(l.quantity) || 0), 0);
  const valid = f.title.trim() && lines.length > 0 && lines.every((l) => l.name.trim() && Number(l.quantity) > 0 && l.unit.trim());

  async function save(submit: boolean) {
    setBusy(submit ? "submit" : "draft"); setError(null);
    try {
      const created = await api<{ id: string }>("/requisitions", { body: {
        title: f.title.trim(), description: f.description.trim() || undefined, priority: f.priority, currency,
        required_date: f.required_date || undefined, submit, directed_supplier_organization_id: directedTo ?? undefined,
        concepts: lines.map((l) => ({ concept_type: l.type, source: "FREE", name: l.name.trim(), quantity: Number(l.quantity), unit_label: l.unit.trim(), estimated_unit_price_minor: l.price ? toMinor(l.price) : undefined })),
      } });
      await qc.invalidateQueries({ queryKey: ["requisitions"] });
      router.push(`/requisiciones/${created.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors[0] ? `${e.fieldErrors[0].field}: ${e.fieldErrors[0].message}` : (e.detail ?? e.title)) : "No se pudo guardar.");
      setBusy(null);
    }
  }

  if (!can("requisition.create")) return <p className="text-sm text-muted-foreground">No tienes permiso para crear requisiciones.</p>;

  return (
    <>
      <Link href="/requisiciones" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Requisiciones</Link>
      {directedTo && <p className="mb-4 rounded-lg border bg-muted px-3 py-2 text-sm">Requisición dirigida a <b>{directedName}</b>: al aprobarse, se le envía la solicitud de cotización automáticamente.</p>}
      <PageHeader title="Nueva requisición" description="Describe lo que necesitas. Después se envía a aprobación y, aprobada, Compras pide cotizaciones." />
      <form onSubmit={(e) => { e.preventDefault(); if (valid) save(true); }} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>General</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="title">Título</Label><Input id="title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej. Aceite y filtros para mantenimiento de motores" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="desc">Descripción <span className="text-muted-foreground">(opcional)</span></Label><Textarea id="desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="prio">Prioridad</Label>
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v ?? "NORMAL" })} items={Object.entries(PRIORITY).map(([value, v]) => ({ value, label: v.label }))}><SelectTrigger id="prio" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="date">Fecha requerida <span className="text-muted-foreground">(opcional)</span></Label><Input id="date" type="date" value={f.required_date} onChange={(e) => setF({ ...f, required_date: e.target.value })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Conceptos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <datalist id="units">{units.data?.data.map((u) => <option key={u.id} value={u.code}>{u.name}</option>)}</datalist>
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_5.5rem_6rem_8rem_auto] sm:items-end">
                <div className="space-y-1"><Label className="text-xs" htmlFor={`n${i}`}>Concepto</Label><Input id={`n${i}`} required value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Tipo</Label>
                  <Select value={l.type} onValueChange={(v) => setLine(i, { type: (v as Line["type"]) ?? "GOOD" })} items={[{ value: "GOOD", label: "Bien" }, { value: "SERVICE", label: "Servicio" }]}><SelectTrigger className="h-8 w-full" aria-label="Tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GOOD">Bien</SelectItem><SelectItem value="SERVICE">Servicio</SelectItem></SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs" htmlFor={`q${i}`}>Cantidad</Label><Input id={`q${i}`} type="number" min="0.0001" step="any" required value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs" htmlFor={`u${i}`}>Unidad</Label><Input id={`u${i}`} list="units" required value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value.toUpperCase() })} /></div>
                <div className="space-y-1"><Label className="text-xs" htmlFor={`p${i}`}>P. unit. est. ({currency})</Label><Input id={`p${i}`} inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></div>
                <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar concepto ${i + 1}`}><Trash2 /></Button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}><Plus />Agregar concepto</Button>
              {total > 0 && <p className="text-sm"><span className="text-muted-foreground">Total estimado </span><span className="font-semibold tabular-nums">{money(total, currency)}</span></p>}
            </div>
          </CardContent>
        </Card>

        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={!valid || !!busy} onClick={() => save(false)}>{busy === "draft" ? "Guardando…" : "Guardar borrador"}</Button>
          <Button type="submit" disabled={!valid || !!busy}>{busy === "submit" ? "Enviando…" : "Enviar a aprobación"}</Button>
        </div>
      </form>
    </>
  );
}

export default function NuevaRequisicion() {
  return <Suspense><NuevaRequisicionForm /></Suspense>;
}
