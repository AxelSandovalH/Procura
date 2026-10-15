"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Image as ImageIcon, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { toMinor } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/ui/status";

interface Draft { is_receipt: boolean; merchant: string | null; date: string | null; currency: string; total_minor: number | null; tax_minor: number | null; payment_method: string | null; description: string; document_number: string | null; confidence: "high" | "medium" | "low"; notes: string | null }
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);
const q = (t: string) => (/[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");

/** Reduce y convierte la foto a JPEG en el navegador (acepta HEIC de iPhone en Safari). */
async function compress(file: File, maxSide = 1800): Promise<Blob> {
  const bmp = await createImageBitmap(file); const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close();
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo procesar la imagen"))), "image/jpeg", 0.85));
}

/** Foto o PDF del ticket de una venta → borrador que la persona revisa; al confirmar crea la venta (con el folio del ticket) y guarda el ticket como comprobante. */
export function ScanSaleButton() {
  const { can } = useSession(); const qc = useQueryClient();
  const camera = useRef<HTMLInputElement>(null); const gallery = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [step, setStep] = useState<"pick" | "reading" | "review">("pick");
  const [image, setImage] = useState<{ blob: Blob; url: string; pdf: boolean; name: string } | null>(null);
  const [dups, setDups] = useState<string[]>([]); const [hint, setHint] = useState<string | null>(null);
  const [f, setF] = useState({ folio: "", date: "", total: "", tax: "16", description: "", method: "" });
  const [collected, setCollected] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  if (!can("sale.manage")) return null;
  const reset = () => { if (image) URL.revokeObjectURL(image.url); setImage(null); setStep("pick"); setError(null); setDups([]); setHint(null); setCollected(true); setF({ folio: "", date: "", total: "", tax: "16", description: "", method: "" }); };

  async function onFile(file: File | undefined) {
    if (!file) return; setError(null);
    try {
      const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (pdf && file.size > 10 * 1024 * 1024) throw new ApiError(400, "Archivo grande", "El PDF excede 10 MB.");
      const blob = pdf ? file : await compress(file); const name = pdf ? file.name : "ticket.jpg";
      setImage({ blob, url: URL.createObjectURL(blob), pdf, name }); setStep("reading");
      const fd = new FormData(); fd.append("file", blob, name);
      const res = await fetch("/api/v1/sales/scan", { method: "POST", body: fd, credentials: "same-origin" }); const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.title ?? "Error", data?.detail);
      const d = data.draft as Draft; setDups((data.possible_duplicates as { folio: string }[]).map((x) => x.folio));
      const rate = d.total_minor && d.tax_minor ? Math.round((d.tax_minor / (d.total_minor - d.tax_minor)) * 100) : 16;
      setHint(!d.is_receipt ? "No parece un ticket. Revisa la foto." : d.notes ?? (d.confidence === "low" ? "Lectura poco segura: revisa cada dato." : null));
      setF({ folio: d.document_number ?? "", date: d.date ?? "", total: d.total_minor != null ? (d.total_minor / 100).toFixed(2) : "", tax: [0, 8, 16].includes(rate) ? String(rate) : "16", description: d.description || "", method: d.payment_method ?? "" });
      setStep("review");
    } catch (e) { setError(err(e, "No se pudo leer el archivo. Puedes capturar la venta a mano.")); setStep("pick"); }
  }

  async function save() {
    if (!image) return; setBusy(true); setError(null);
    try {
      const csv = `Folio,Fecha,Total,Forma de pago,Producto\n${q(f.folio.trim())},${ddmmyyyy(f.date)},${(toMinor(f.total) / 100).toFixed(2)},${q(PAYMENT_METHOD[f.method] ?? "")},${q(f.description.trim())}\n`;
      const r = await api<{ created: number; duplicates: number; folio_conflicts: string[]; ids: string[] }>("/sales/import", { body: { csv, dry_run: false, tax_percent: Number(f.tax), mark_collected: collected && can("payment.manage") } });
      if (r.created === 0) throw new ApiError(409, "No se creó", r.duplicates ? "Ese ticket ya está registrado como venta." : "El folio del ticket ya lo usa otra venta.");
      const fd = new FormData(); fd.append("file", image.blob, image.name); fd.append("anchor_type", "SALE"); fd.append("anchor_id", r.ids[0]!);
      await fetch("/api/v1/attachments", { method: "POST", body: fd, credentials: "same-origin" }).catch(() => null); // la venta ya existe: si la foto falla se adjunta luego
      await Promise.all(["sales", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] }))); setOpen(false); reset();
    } catch (e) { setError(err(e, "No se pudo guardar la venta.")); } finally { setBusy(false); }
  }

  const valid = f.folio.trim() && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && Number(f.total) > 0 && f.description.trim();
  return (
    <>
      <Button variant="outline" onClick={() => { reset(); setOpen(true); }}><ScanLine />Desde ticket</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Registrar venta desde un ticket</DialogTitle><DialogDescription>Toma una foto o sube el PDF del ticket de venta. Leemos folio, fecha, total y forma de pago; tú revisas y confirmas. El ticket queda como comprobante de la venta.</DialogDescription></DialogHeader>
        {step === "pick" && (
          <div className="space-y-3">
            <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Tomar foto del ticket" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={gallery} type="file" accept="image/*,application/pdf,.pdf" className="sr-only" aria-label="Elegir foto o PDF" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="grid gap-2 sm:grid-cols-2"><Button onClick={() => camera.current?.click()}><Camera />Tomar foto</Button><Button variant="outline" onClick={() => gallery.current?.click()}><ImageIcon />Foto de galería o PDF</Button></div>
            <p className="text-xs text-muted-foreground">La imagen se envía al servicio de lectura de Claude solo para extraer los datos. Nada se guarda sin que lo confirmes.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>)}
        {step === "reading" && <div className="space-y-3 text-center text-sm"><div className="mx-auto h-48 w-40 animate-pulse rounded-lg bg-muted" /><p role="status">Leyendo el ticket…</p></div>}
        {step === "review" && image && (
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            {image.pdf ? <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-center text-xs text-muted-foreground"><FileText className="size-8" /><span className="break-all">{image.name}</span></div>
              // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
              : <img src={image.url} alt="Foto del ticket" className="max-h-72 w-full rounded-lg border object-contain" />}
            <div className="space-y-3">
              {hint && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{hint}</p>}
              {f.folio && dups.includes(f.folio) && <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">Ya hay una venta con el folio {f.folio}: no se creará otra.</p>}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="ss-folio" className="text-xs">Folio del ticket *</Label><Input id="ss-folio" maxLength={40} value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ss-date" className="text-xs">Fecha *</Label><Input id="ss-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ss-total" className="text-xs">Total (con IVA) *</Label><Input id="ss-total" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ss-tax" className="text-xs">IVA incluido</Label><select id="ss-tax" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })}><option value="16">16 %</option><option value="8">8 %</option><option value="0">Sin IVA</option></select></div>
              </div>
              <div className="space-y-1"><Label htmlFor="ss-desc" className="text-xs">Descripción *</Label><Input id="ss-desc" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              {can("payment.manage") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={collected} onChange={(e) => setCollected(e.target.checked)} /><span>Ya está cobrada{f.method ? ` (${PAYMENT_METHOD[f.method] ?? f.method})` : ""}</span></label>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          </div>)}
        <DialogFooter>
          {step === "review" && <Button variant="outline" onClick={reset} disabled={busy}>Otro ticket</Button>}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          {step === "review" && <Button onClick={() => void save()} disabled={busy || !valid}>{busy ? "Guardando…" : "Guardar venta"}</Button>}
        </DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}
