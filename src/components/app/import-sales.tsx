"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";

interface Preview { rows: number; new: number; duplicates: number; from: string; to: string; total_minor: number; currency: string; warnings: string[]; skipped: { invalid: number; canceled: number; refunds: number }; columns: Record<string, string | null>; created?: number; folio_conflicts?: string[] }
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);
/** UTF-8 y, si no lo es (muchos puntos de venta exportan en Windows-1252), con ese juego de caracteres. */
async function readText(file: File) { const buf = await file.arrayBuffer(); try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); } }

/** Importa las ventas de tu punto de venta desde su archivo CSV, para no capturarlas dos veces. */
export function ImportSalesButton() {
  const { can } = useSession(); const qc = useQueryClient();
  const [open, setOpen] = useState(false); const [csv, setCsv] = useState<string | null>(null); const [name, setName] = useState("");
  const [tax, setTax] = useState<0 | 8 | 16>(16); const [collected, setCollected] = useState(true);
  const [prev, setPrev] = useState<Preview | null>(null); const [done, setDone] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  if (!can("sale.manage")) return null;
  const reset = () => { setCsv(null); setName(""); setPrev(null); setDone(null); setError(null); };
  const body = (dry: boolean, text = csv) => ({ csv: text, dry_run: dry, tax_percent: tax, mark_collected: collected && can("payment.manage") });
  async function pick(file: File | undefined) {
    if (!file) return; setPrev(null); setDone(null); setError(null); setBusy(true);
    try { const text = await readText(file); setCsv(text); setName(file.name); setPrev(await api<Preview>("/sales/import", { body: body(true, text) })); }
    catch (e) { setError(err(e, "No pude leer el archivo.")); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError(null);
    try { setDone(await api<Preview>("/sales/import", { body: body(false) })); await Promise.all(["sales", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] }))); }
    catch (e) { setError(err(e, "No se pudo importar.")); } finally { setBusy(false); }
  }
  return (
    <>
      <Button variant="outline" onClick={() => { reset(); setOpen(true); }}><Upload />Importar ventas</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}><DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar ventas de tu punto de venta</DialogTitle><DialogDescription>Sube el archivo CSV que exporta tu punto de venta (tickets o un corte diario). Necesita una columna de fecha y otra de total; si trae folio del ticket, tus clientes podrán facturarlo con ese folio.</DialogDescription></DialogHeader>
        {done ? (
          <div className="space-y-2 text-sm"><p role="status" className="font-medium">Listo: {done.created ?? done.new} venta{(done.created ?? done.new) === 1 ? "" : "s"} importada{(done.created ?? done.new) === 1 ? "" : "s"} por {money(done.total_minor, done.currency)}{done.duplicates ? ` · ${done.duplicates} ya estaban` : ""}.</p>
            {(done.folio_conflicts?.length ?? 0) > 0 && <p role="alert" className="text-amber-700">No se importaron {done.folio_conflicts!.length} ticket{done.folio_conflicts!.length > 1 ? "s" : ""} porque su folio ya lo usa otra venta: {done.folio_conflicts!.slice(0, 8).join(", ")}{done.folio_conflicts!.length > 8 ? "…" : ""}.</p>}</div>
        ) : (
          <div className="space-y-4 text-sm">
            <fieldset className="space-y-2"><legend className="mb-1 font-medium">Los totales del archivo…</legend>
              {([[16, "Ya incluyen IVA de 16%"], [8, "Ya incluyen IVA de 8% (región fronteriza)"], [0, "No llevan IVA"]] as const).map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="radio" name="tax" checked={tax === v} onChange={() => setTax(v)} />{l}</label>)}</fieldset>
            {can("payment.manage") && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={collected} onChange={(e) => setCollected(e.target.checked)} />Marcar las ventas como cobradas el día de la venta (lo normal en un punto de venta)</label>}
            <div className="space-y-1.5"><Label htmlFor="sv-file">Archivo CSV</Label><input id="sv-file" type="file" accept=".csv,.txt,text/csv" onChange={(e) => void pick(e.target.files?.[0])} /></div>
            {busy && <p className="text-muted-foreground">Leyendo…</p>}
            {prev && (
              <div className="space-y-1 rounded-lg border bg-muted/30 p-3"><p className="font-medium">{name}</p>
                <p>{prev.rows} venta{prev.rows === 1 ? "" : "s"} del {dateShort(prev.from)} al {dateShort(prev.to)} por {money(prev.total_minor, prev.currency)}: <b>{prev.new} nuevas</b>{prev.duplicates > 0 && `, ${prev.duplicates} ya estaban`}.</p>
                <p className="text-xs text-muted-foreground">Columnas usadas: {Object.entries(prev.columns).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}.</p>
                {prev.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}</div>)}
            {error && <p role="alert" className="text-destructive">{error}</p>}
          </div>)}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{done ? "Cerrar" : "Cancelar"}</Button>{!done && <Button onClick={() => void confirm()} disabled={busy || !prev || prev.new === 0}>{prev ? `Importar ${prev.new} nueva${prev.new === 1 ? "" : "s"}` : "Importar"}</Button>}</DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}
