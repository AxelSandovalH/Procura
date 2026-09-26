"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateTime } from "@/lib/format";
import type { Tone } from "@/lib/ui/status";

type Field = "sku" | "name" | "description" | "item_type" | "unit" | "price" | "category" | "is_active";
const FIELDS: { key: Field; label: string; required?: boolean; hint?: string; guess: RegExp }[] = [
  { key: "sku", label: "SKU / código", required: true, guess: /^(sku|c[oó]digo|code|clave)$/i },
  { key: "name", label: "Nombre", required: true, guess: /^(nombre|name|producto|art[ií]culo|descripci[oó]n corta)$/i },
  { key: "description", label: "Descripción", guess: /^(descripci[oó]n|description|detalle)$/i },
  { key: "item_type", label: "Tipo (bien / servicio)", guess: /^(tipo|type)$/i },
  { key: "unit", label: "Unidad", hint: "Código como KG, PZA, LT", guess: /^(unidad|unit|um|u\.?m\.?)$/i },
  { key: "price", label: "Precio de lista", guess: /^(precio|price|costo|pvp)/i },
  { key: "category", label: "Categoría", hint: "Debe existir ya en tu catálogo", guess: /^(categor[ií]a|category|familia)$/i },
  { key: "is_active", label: "Activo", hint: "Sí / No", guess: /^(activo|active|estatus|status)$/i },
];
interface Uploaded { id: string; detected_columns: string[]; sample_rows: Record<string, string>[] }
interface Summary { total: number; ok: number; warnings: number; errors: number; to_create: number; to_update: number; skipped: number }
interface Row { row_number: number; raw: Record<string, string>; level: string; messages: { field: string; level: string; message: string }[]; action: string | null; normalized: { sku?: string; name?: string } | null }
interface Import { id: string; status: string; format: string; created_at: string; summary: Record<string, number> | null }
const LEVEL: Record<string, { label: string; tone: Tone }> = { OK: { label: "OK", tone: "ok" }, WARNING: { label: "Aviso", tone: "warn" }, ERROR: { label: "Error", tone: "bad" } };
const IMPORT_STATUS: Record<string, { label: string; tone: Tone }> = { UPLOADED: { label: "Subido", tone: "muted" }, VALIDATED: { label: "Validado", tone: "info" }, CONFIRMED: { label: "Aplicado", tone: "ok" }, FAILED: { label: "Falló", tone: "bad" } };
const NONE = "__none";

export default function ImportarCatalogo() {
  const session = useSession();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [up, setUp] = useState<Uploaded | null>(null);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["catalog-imports"], queryFn: () => api<{ data: Import[] }>("/catalog/imports"), enabled: session.can("catalog.import") });
  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : fallback);

  if (!session.loading && !session.can("catalog.import")) return <p className="text-sm text-muted-foreground">No tienes permiso para importar catálogo.</p>;

  async function upload(file: File) {
    setBusy(true); setError(null);
    const fd = new FormData(); fd.set("file", file);
    try {
      const res = await fetch("/api/v1/catalog/imports", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, d?.title ?? "Error", d?.detail);
      const u: Uploaded = { id: d.id, detected_columns: d.detected_columns, sample_rows: d.sample_rows };
      const guess: Partial<Record<Field, string>> = {};
      for (const f of FIELDS) { const h = u.detected_columns.find((c) => f.guess.test(c.trim())); if (h) guess[f.key] = h; }
      setUp(u); setMap(guess); setStep(2);
    } catch (e) { fail(e, "No se pudo subir el archivo."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function validate() {
    setBusy(true); setError(null);
    try {
      const columns = Object.fromEntries(Object.entries(map).filter(([, v]) => v)) as Record<string, string>;
      const r = await api<{ summary: Summary }>(`/catalog/imports/${up!.id}/mapping`, { method: "PUT", body: { columns } });
      const all = await api<{ data: Row[] }>(`/catalog/imports/${up!.id}/rows`);
      setSummary(r.summary); setRows(all.data.filter((x) => x.level !== "OK")); setStep(3);
    } catch (e) { fail(e, "No se pudo validar."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ summary: { created: number; updated: number } }>(`/catalog/imports/${up!.id}/confirm`, { method: "POST", body: {} });
      setResult({ created: r.summary.created, updated: r.summary.updated }); setStep(4);
      await Promise.all(["catalog-imports", "catalog-items"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e) { fail(e, "No se pudo aplicar la importación."); }
    finally { setBusy(false); }
  }
  function reset() { setStep(1); setUp(null); setMap({}); setSummary(null); setRows([]); setResult(null); setError(null); }
  function template() {
    const csv = "sku,nombre,descripcion,tipo,unidad,precio,categoria,activo\nMG-001,Mango Ataulfo,Caja de 10 kg,bien,KG,45.50,Frutas,si\n";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = "plantilla-catalogo.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  const cols = up?.detected_columns ?? [];
  const items = [{ value: NONE, label: "— No importar —" }, ...cols.map((c) => ({ value: c, label: c }))];
  const ready = !!map.sku && !!map.name;
  const stepNames = ["Archivo", "Columnas", "Revisión", "Listo"];

  return (
    <>
      <Link href="/catalogo" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Catálogo</Link>
      <PageHeader title="Importar catálogo" description="Carga o actualiza muchos artículos desde un archivo CSV o Excel. Los SKU que ya existen se actualizan; nada se borra." />
      <ol className="mb-6 grid grid-cols-4 gap-2 text-xs" aria-label="Progreso">{stepNames.map((n, i) => (
        <li key={n} aria-current={i + 1 === step ? "step" : undefined} className={`border-t-2 pt-2 ${i + 1 <= step ? "border-primary" : "border-border text-muted-foreground"} ${i + 1 === step ? "font-medium" : ""}`}>{i + 1}. {n}</li>))}</ol>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {step === 1 && (
        <Card><CardContent className="space-y-4 pt-4">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
            <FileSpreadsheet className="size-8 text-muted-foreground" />
            <p className="text-sm">Sube un archivo <b>.csv</b> o <b>.xlsx</b> (máx. 10 MB). La primera fila debe tener los nombres de columna.</p>
            <input ref={input} type="file" id="import-file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => input.current?.click()} disabled={busy}><Upload />{busy ? "Leyendo archivo…" : "Elegir archivo"}</Button><Button variant="outline" onClick={template}><Download />Descargar plantilla</Button></div>
          </div>
        </CardContent></Card>)}

      {step === 2 && up && (
        <Card>
          <CardHeader><CardTitle>¿Qué contiene cada columna?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Detectamos {cols.length} columnas. Ya sugerimos las que reconocimos; ajusta lo que haga falta. SKU y nombre son obligatorios.</p>
            <div className="grid gap-3 sm:grid-cols-2">{FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}{f.required && " *"}</Label>
                <Select items={items} value={map[f.key] ?? NONE} onValueChange={(v) => setMap((m) => ({ ...m, [f.key]: !v || v === NONE ? undefined : v }))}>
                  <SelectTrigger className="w-full" aria-label={f.label}><SelectValue /></SelectTrigger>
                  <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
                </Select>
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              </div>))}</div>
            <div className="space-y-1.5"><p className="text-sm font-medium">Vista previa del archivo</p>
              <Table><TableHeader><TableRow>{cols.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>{up.sample_rows.slice(0, 5).map((r, i) => <TableRow key={i}>{cols.map((c) => <TableCell key={c} className="max-w-40 truncate">{r[c]}</TableCell>)}</TableRow>)}</TableBody></Table></div>
            <div className="flex gap-2"><Button variant="outline" onClick={reset} disabled={busy}>Cambiar archivo</Button><Button onClick={validate} disabled={!ready || busy}>{busy ? "Validando…" : "Validar"}</Button></div>
          </CardContent>
        </Card>)}

      {step === 3 && summary && (
        <Card>
          <CardHeader><CardTitle>Revisión antes de aplicar</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-lg border p-3"><dt className="text-muted-foreground">Se crearán</dt><dd className="text-xl font-semibold tabular-nums">{summary.to_create}</dd></div>
              <div className="rounded-lg border p-3"><dt className="text-muted-foreground">Se actualizarán</dt><dd className="text-xl font-semibold tabular-nums">{summary.to_update}</dd></div>
              <div className="rounded-lg border p-3"><dt className="text-muted-foreground">Con avisos</dt><dd className="text-xl font-semibold tabular-nums">{summary.warnings}</dd></div>
              <div className="rounded-lg border p-3"><dt className="text-muted-foreground">Con errores (se omiten)</dt><dd className={`text-xl font-semibold tabular-nums ${summary.errors ? "text-destructive" : ""}`}>{summary.errors}</dd></div>
            </dl>
            {rows.length > 0 && (
              <div className="space-y-1.5"><p className="text-sm font-medium">Filas con observaciones{rows.length >= 500 ? " (primeras 500)" : ""}</p>
                <div className="max-h-80 overflow-y-auto rounded-lg border"><Table>
                  <TableHeader><TableRow><TableHead>Fila</TableHead><TableHead>SKU</TableHead><TableHead>Nivel</TableHead><TableHead>Detalle</TableHead></TableRow></TableHeader>
                  <TableBody>{rows.map((r) => (
                    <TableRow key={r.row_number}><TableCell className="tabular-nums">{r.row_number + 1}</TableCell><TableCell className="font-mono text-xs">{r.normalized?.sku ?? (map.sku ? r.raw[map.sku] : "") ?? ""}</TableCell>
                      <TableCell><StatusBadge {...(LEVEL[r.level] ?? { label: r.level, tone: "neutral" as const })} /></TableCell>
                      <TableCell className="whitespace-normal text-xs">{r.messages.map((m) => `${m.field}: ${m.message}`).join(" · ")}</TableCell></TableRow>))}</TableBody>
                </Table></div></div>)}
            <p className="text-sm text-muted-foreground">{summary.to_create + summary.to_update === 0 ? "No hay filas válidas para aplicar." : `Se aplicarán ${summary.to_create + summary.to_update} filas; las que tienen error no se importan.`}</p>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)} disabled={busy}>Ajustar columnas</Button><Button onClick={confirm} disabled={busy || summary.to_create + summary.to_update === 0}>{busy ? "Aplicando…" : "Aplicar importación"}</Button></div>
          </CardContent>
        </Card>)}

      {step === 4 && result && (
        <Card><CardContent className="space-y-4 pt-4 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check /></div>
          <p className="text-lg font-medium">Importación aplicada</p>
          <p className="text-sm text-muted-foreground">{result.created} artículos creados y {result.updated} actualizados.</p>
          <div className="flex justify-center gap-2"><Link href="/catalogo" className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80">Ver catálogo</Link><Button variant="outline" onClick={reset}>Importar otro archivo</Button></div>
        </CardContent></Card>)}

      {(history.data?.data.length ?? 0) > 0 && (
        <Card className="mt-8"><CardHeader><CardTitle>Importaciones anteriores</CardTitle></CardHeader><CardContent className="px-0">
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Formato</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Filas</TableHead><TableHead className="text-right">Creados</TableHead><TableHead className="text-right">Actualizados</TableHead></TableRow></TableHeader>
            <TableBody>{history.data!.data.map((h) => (
              <TableRow key={h.id}><TableCell>{dateTime(h.created_at)}</TableCell><TableCell>{h.format}</TableCell><TableCell><StatusBadge {...(IMPORT_STATUS[h.status] ?? { label: h.status, tone: "neutral" as const })} /></TableCell>
                <TableCell className="text-right tabular-nums">{h.summary?.total_rows ?? h.summary?.total ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{h.summary?.created ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{h.summary?.updated ?? "—"}</TableCell></TableRow>))}</TableBody>
          </Table></div>
        </CardContent></Card>)}
    </>
  );
}
