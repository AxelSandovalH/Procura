"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Handshake, Plus, Search, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { WizardFooter, WizardSteps } from "@/components/wizard/wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { money, toMinor } from "@/lib/format";
import { PRIORITY } from "@/lib/ui/status";
import { cn } from "@/lib/utils";

type Source = "FREE" | "CATALOG" | "SUPPLIER_CATALOG";
interface Line { name: string; type: "GOOD" | "SERVICE"; quantity: string; unit: string; price: string; source: Source; refId?: string }
interface Named { id: string; name: string }
interface Relationship { id: string; supplier: { id: string; display_name: string } }
interface CatItem { id: string; sku: string; name: string; item_type: "GOOD" | "SERVICE"; unit_label: string; list_price_minor: number | string | null }
type Mode = "open" | "suggest" | "directed";
const blank = (): Line => ({ name: "", type: "GOOD", quantity: "1", unit: "PZA", price: "", source: "FREE" });
const NONE = "__none";
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0] ? `${e.fieldErrors[0].field}: ${e.fieldErrors[0].message}` : (e.detail ?? e.title)) : f);

function NuevaRequisicionWizard() {
  const router = useRouter();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const { org, can } = useSession();
  const preDirected = /^[0-9a-f-]{36}$/i.test(sp.get("proveedor") ?? "") ? sp.get("proveedor") : null;
  const currency = org?.base_currency ?? "MXN";

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null); const [error, setError] = useState<string | null>(null);
  // Datos
  const [f, setF] = useState({ title: "", description: "", priority: "NORMAL", required_date: "", department: NONE, location: NONE, contact: "" });
  // Proveedor
  const [mode, setMode] = useState<Mode>(preDirected ? "directed" : "open"); const [supplierId, setSupplierId] = useState<string | null>(preDirected);
  // Conceptos
  const [lines, setLines] = useState<Line[]>([blank()]); const [pickerOpen, setPickerOpen] = useState(false); const [pickerSrc, setPickerSrc] = useState<"own" | "supplier">("own"); const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  // Revisión
  const [budget, setBudget] = useState("");

  const units = useQuery({ queryKey: ["units"], queryFn: () => api<{ data: { id: string; code: string; name: string }[] }>("/catalog/units"), staleTime: 300_000 });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<{ data: Named[] }>("/organization/departments"), staleTime: 60_000 });
  const locations = useQuery({ queryKey: ["locations"], queryFn: () => api<{ data: Named[] }>("/organization/locations"), staleTime: 60_000 });
  const rels = useQuery({ queryKey: ["relationships", "BUYER", "ACTIVE"], queryFn: () => api<{ data: Relationship[] }>("/relationships?position=BUYER&status=ACTIVE"), enabled: can("relationship.read") });
  const suppliers = rels.data?.data ?? [];
  const chosen = suppliers.find((r) => r.supplier.id === supplierId);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const catalog = useQuery({
    queryKey: ["req-catalog", pickerSrc, chosen?.id, term], enabled: pickerOpen && (pickerSrc === "own" ? can("catalog.read") : !!chosen && can("shared_catalog.read")),
    queryFn: () => api<{ data: CatItem[] }>(pickerSrc === "own" ? `/catalog/items${term ? `?q=${encodeURIComponent(term)}` : ""}` : `/relationships/${chosen!.id}/shared-catalog${term ? `?q=${encodeURIComponent(term)}` : ""}`),
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((acc, l) => acc + toMinor(l.price || "0") * (Number(l.quantity) || 0), 0);
  const step0 = f.title.trim().length > 0;
  const step1 = mode === "open" || !!supplierId;
  const step2 = lines.length > 0 && lines.every((l) => l.name.trim() && Number(l.quantity) > 0 && l.unit.trim());
  const budgetMinor = budget.trim() ? toMinor(budget) : null;
  const overBudget = budgetMinor != null && total > budgetMinor;
  const go = (d: number) => { setError(null); setStep((s) => Math.max(0, Math.min(3, s + d))); };

  function addFromCatalog(it: CatItem) {
    const unit = it.unit_label || "PZA";
    const line: Line = { name: it.name, type: it.item_type, quantity: "1", unit, price: it.list_price_minor != null ? (Number(it.list_price_minor) / 100).toFixed(2) : "", source: pickerSrc === "own" ? "CATALOG" : "SUPPLIER_CATALOG", refId: it.id };
    setLines((ls) => (ls.length === 1 && !ls[0].name.trim() ? [line] : [...ls, line]));
    setPickerOpen(false); setQ("");
  }

  async function save(submit: boolean) {
    setBusy(submit ? "submit" : "draft"); setError(null);
    try {
      const created = await api<{ id: string }>("/requisitions", { body: {
        title: f.title.trim(), description: f.description.trim() || undefined, priority: f.priority, currency, required_date: f.required_date || undefined, submit,
        department_id: f.department !== NONE ? f.department : undefined, delivery_location_id: f.location !== NONE ? f.location : undefined, destination_contact: f.contact.trim() || undefined,
        budget_max_minor: budgetMinor ?? undefined,
        ...(mode === "suggest" && supplierId ? { suggested_supplier_organization_id: supplierId } : {}), ...(mode === "directed" && supplierId ? { directed_supplier_organization_id: supplierId } : {}),
        concepts: lines.map((l) => ({
          concept_type: l.type, source: l.source, name: l.name.trim(), quantity: Number(l.quantity), unit_label: l.unit.trim(), estimated_unit_price_minor: l.price ? toMinor(l.price) : undefined,
          ...(l.source === "CATALOG" ? { catalog_item_id: l.refId } : {}), ...(l.source === "SUPPLIER_CATALOG" ? { supplier_catalog_item_id: l.refId } : {}),
        })),
      } });
      await Promise.all(["requisitions", "onboarding-status"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      router.push(`/requisiciones/${created.id}`);
    } catch (e) { setError(err(e, "No se pudo guardar.")); setBusy(null); }
  }

  if (!can("requisition.create")) return <p className="text-sm text-muted-foreground">No tienes permiso para crear requisiciones.</p>;
  const steps = ["Datos", "Proveedor", "Conceptos", "Revisión"];
  const draftAction = step > 0 && step0 ? () => void save(false) : undefined;

  return (
    <>
      <Link href="/requisiciones" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Requisiciones</Link>
      <PageHeader title="Nueva requisición" description="Cuéntanos qué necesitas. Después se envía a aprobación y, aprobada, se piden cotizaciones." />
      <div className="max-w-3xl space-y-6">
        <WizardSteps steps={steps} current={step} />
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        {step === 0 && (<>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="title">¿Qué necesitas? *</Label><Input id="title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej. Aceite y filtros para mantenimiento de motores" autoFocus /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="desc">Detalles <span className="text-muted-foreground">(opcional)</span></Label><Textarea id="desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Para qué es, especificaciones, marcas aceptables…" /></div>
            <div className="space-y-1.5"><Label>Prioridad</Label><Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v ?? "NORMAL" })} items={Object.entries(PRIORITY).map(([value, v]) => ({ value, label: v.label }))}><SelectTrigger className="w-full" aria-label="Prioridad"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="date">Fecha en que lo necesitas <span className="text-muted-foreground">(opcional)</span></Label><Input id="date" type="date" value={f.required_date} onChange={(e) => setF({ ...f, required_date: e.target.value })} /></div>
            {(departments.data?.data.length ?? 0) > 0 && <div className="space-y-1.5"><Label>Departamento <span className="text-muted-foreground">(opcional)</span></Label>
              <Select value={f.department} onValueChange={(v) => setF({ ...f, department: v ?? NONE })} items={[{ value: NONE, label: "Sin departamento" }, ...departments.data!.data.map((d) => ({ value: d.id, label: d.name }))]}><SelectTrigger className="w-full" aria-label="Departamento"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Sin departamento</SelectItem>{departments.data!.data.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>}
            {(locations.data?.data.length ?? 0) > 0 && <div className="space-y-1.5"><Label>Lugar de entrega <span className="text-muted-foreground">(opcional)</span></Label>
              <Select value={f.location} onValueChange={(v) => setF({ ...f, location: v ?? NONE })} items={[{ value: NONE, label: "Sin especificar" }, ...locations.data!.data.map((d) => ({ value: d.id, label: d.name }))]}><SelectTrigger className="w-full" aria-label="Lugar de entrega"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Sin especificar</SelectItem>{locations.data!.data.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>}
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="contact">Contacto para recibir <span className="text-muted-foreground">(opcional)</span></Label><Input id="contact" maxLength={200} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="Nombre y teléfono de quien recibe" /></div>
          </div>
          <WizardFooter onNext={() => go(1)} disabled={!step0} />
        </>)}

        {step === 1 && (<>
          <div className="space-y-1"><h2 className="text-lg font-semibold">¿A quién se le pide?</h2><p className="text-sm text-muted-foreground">Puedes dejarlo abierto y que Compras decida.</p></div>
          <div role="radiogroup" aria-label="Proveedor" className="grid gap-2">
            {([["open", Users, "Que Compras decida", "Lo verá el área de compras y elegirá a quién pedir cotización."], ["suggest", BookOpen, "Sugerir un proveedor", "Compras lo verá como sugerencia; puede pedir a otros también."], ["directed", Handshake, "Dirigirla a un proveedor", "Al aprobarse, se le pide cotización automáticamente."]] as const).map(([id, Icon, t, d]) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => { setMode(id); if (id === "open") setSupplierId(null); }} className={cn("flex items-start gap-3 rounded-xl border p-3 text-left hover:bg-muted/50", mode === id && "border-primary bg-muted/60 ring-1 ring-primary")}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon className="size-4" /></span><span><span className="block font-medium">{t}</span><span className="block text-sm text-muted-foreground">{d}</span></span></button>))}
          </div>
          {mode !== "open" && (suppliers.length === 0 && !preDirected ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aún no tienes proveedores conectados. <Link href="/relaciones/conectar?tipo=proveedor" className="font-medium text-foreground underline underline-offset-4">Conecta con uno</Link> o deja la requisición abierta.</p>
          ) : (
            <div className="space-y-1.5"><Label>Proveedor</Label>
              <Select value={supplierId} onValueChange={setSupplierId} items={suppliers.map((r) => ({ value: r.supplier.id, label: r.supplier.display_name }))}><SelectTrigger className="w-full sm:w-80" aria-label="Proveedor"><SelectValue placeholder={preDirected ? (sp.get("nombre") ?? "Proveedor del portal") : "Selecciona…"} /></SelectTrigger><SelectContent>{suppliers.map((r) => <SelectItem key={r.supplier.id} value={r.supplier.id}>{r.supplier.display_name}</SelectItem>)}</SelectContent></Select></div>))}
          <WizardFooter onBack={() => go(-1)} onNext={() => go(1)} disabled={!step1} onSkip={draftAction} skipLabel="Guardar borrador" />
        </>)}

        {step === 2 && (<>
          <div className="space-y-1"><h2 className="text-lg font-semibold">Conceptos</h2><p className="text-sm text-muted-foreground">Lo que necesitas, con cantidad y unidad. El precio estimado es opcional y solo lo ve tu organización.</p></div>
          <datalist id="units">{units.data?.data.map((u) => <option key={u.id} value={u.code}>{u.name}</option>)}</datalist>
          <div className="space-y-3">{lines.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_5.5rem_6rem_8rem_auto] sm:items-end">
              <div className="space-y-1"><Label className="text-xs" htmlFor={`n${i}`}>Concepto{l.source !== "FREE" && <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10px]">{l.source === "CATALOG" ? "Mi catálogo" : "Del proveedor"}</span>}</Label><Input id={`n${i}`} required value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Tipo</Label>
                <Select value={l.type} onValueChange={(v) => setLine(i, { type: (v as Line["type"]) ?? "GOOD" })} items={[{ value: "GOOD", label: "Bien" }, { value: "SERVICE", label: "Servicio" }]}><SelectTrigger className="h-8 w-full" aria-label={`Tipo del concepto ${i + 1}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GOOD">Bien</SelectItem><SelectItem value="SERVICE">Servicio</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`q${i}`}>Cantidad</Label><Input id={`q${i}`} type="number" min="0.0001" step="any" required value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`u${i}`}>Unidad</Label><Input id={`u${i}`} list="units" required value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value.toUpperCase() })} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`p${i}`}>P. unit. est. ({currency})</Label><Input id={`p${i}`} inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></div>
              <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar concepto ${i + 1}`}><Trash2 /></Button>
            </div>))}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}><Plus />Agregar concepto</Button>
            {can("catalog.read") && <Button type="button" variant="outline" onClick={() => { setPickerSrc("own"); setPickerOpen(true); }}><BookOpen />Desde mi catálogo</Button>}
            {chosen && can("shared_catalog.read") && <Button type="button" variant="outline" onClick={() => { setPickerSrc("supplier"); setPickerOpen(true); }}><BookOpen />Del catálogo de {chosen.supplier.display_name}</Button>}
          </div>
          {pickerOpen && (
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2"><div className="relative flex-1"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input autoFocus aria-label="Buscar en el catálogo" className="pl-8" placeholder="Buscar por SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} /></div><Button type="button" variant="ghost" onClick={() => setPickerOpen(false)}>Cerrar</Button></div>
              {catalog.isLoading ? <div className="h-12 animate-pulse rounded bg-muted" /> : (catalog.data?.data.length ?? 0) === 0 ? <p className="px-1 text-sm text-muted-foreground">{term ? "Sin coincidencias." : "No hay artículos para mostrar."}</p> : (
                <ul className="max-h-56 divide-y overflow-y-auto text-sm">{catalog.data!.data.slice(0, 50).map((it) => (
                  <li key={it.id}><button type="button" onClick={() => addFromCatalog(it)} className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left hover:bg-muted"><span><span className="font-mono text-xs text-muted-foreground">{it.sku}</span> <span className="font-medium">{it.name}</span></span><span className="text-xs text-muted-foreground">{it.unit_label}{it.list_price_minor != null ? ` · ${money(it.list_price_minor, currency)}` : ""}</span></button></li>))}</ul>)}
            </div>)}
          {total > 0 && <p className="text-right text-sm"><span className="text-muted-foreground">Total estimado </span><span className="font-semibold tabular-nums">{money(total, currency)}</span></p>}
          <WizardFooter onBack={() => go(-1)} onNext={() => go(1)} disabled={!step2} onSkip={draftAction} skipLabel="Guardar borrador" />
        </>)}

        {step === 3 && (<>
          <div className="space-y-3 rounded-xl border p-4 text-sm">
            <div><p className="text-base font-semibold">{f.title.trim()}</p>{f.description.trim() && <p className="mt-0.5 text-muted-foreground">{f.description.trim()}</p>}</div>
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Prioridad</dt><dd>{PRIORITY[f.priority]?.label}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fecha requerida</dt><dd>{f.required_date || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Departamento</dt><dd>{departments.data?.data.find((d) => d.id === f.department)?.name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Entrega</dt><dd>{locations.data?.data.find((d) => d.id === f.location)?.name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted-foreground">Proveedor</dt><dd>{mode === "open" ? "Que Compras decida" : `${mode === "directed" ? "Dirigida a" : "Sugerido:"} ${chosen?.supplier.display_name ?? sp.get("nombre") ?? "—"}`}</dd></div>
            </dl>
            <ul className="divide-y rounded-lg border">{lines.map((l, i) => <li key={i} className="flex items-center justify-between gap-3 px-3 py-2"><span>{l.name} <span className="text-muted-foreground">· {l.quantity} {l.unit}</span></span><span className="tabular-nums text-muted-foreground">{l.price ? money(toMinor(l.price) * Number(l.quantity), currency) : "—"}</span></li>)}</ul>
            {total > 0 && <p className="flex justify-between font-semibold"><span>Total estimado</span><span className="tabular-nums">{money(total, currency)}</span></p>}
          </div>
          <div className="space-y-1.5"><Label htmlFor="budget">Presupuesto máximo ({currency}) <span className="text-muted-foreground">(opcional, privado)</span></Label><Input id="budget" inputMode="decimal" className="w-44" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Sin tope" />
            {overBudget && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">El total estimado ({money(total, currency)}) supera tu presupuesto máximo.</p>}
            <p className="text-xs text-muted-foreground">Ni el presupuesto ni tus precios estimados llegan al proveedor.</p></div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => go(-1)} disabled={!!busy}>Atrás</Button>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!!busy} onClick={() => void save(false)}>{busy === "draft" ? "Guardando…" : "Guardar borrador"}</Button><Button type="button" disabled={!!busy} onClick={() => void save(true)}>{busy === "submit" ? "Enviando…" : "Enviar a aprobación"}</Button></div>
          </div>
        </>)}
      </div>
    </>
  );
}

export default function NuevaRequisicion() { return <Suspense><NuevaRequisicionWizard /></Suspense>; }
