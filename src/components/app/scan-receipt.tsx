"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, FileText, Image as ImageIcon, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePasteImage } from "@/hooks/use-paste-image";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { toMinor } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/ui/status";

interface Draft { fiscal_uuid?: string | null; is_receipt: boolean; merchant: string | null; merchant_tax_id: string | null; date: string | null; currency: string; total_minor: number | null; tax_minor: number | null; payment_method: string | null; description: string; category: string | null; confidence: "high" | "medium" | "low"; notes: string | null }
interface ScanResult { draft: Draft; document_reference: string | null; possible_duplicates: { id: string; description: string }[] }
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);

/** Reduce y convierte la foto a JPEG en el navegador (acepta HEIC de iPhone en Safari): sube menos y el lector recibe un formato válido. */
async function compress(file: File, maxSide = 1800): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close();
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo procesar la imagen"))), "image/jpeg", 0.85));
}

/** Foto del ticket → borrador de gasto que la persona revisa y confirma. Guarda también la foto como evidencia del gasto. */
export function ScanReceiptButton({ onSaved, pasteEnabled = false }: { onSaved: () => Promise<unknown>; pasteEnabled?: boolean }) {
  const { org, can } = useSession();
  const camera = useRef<HTMLInputElement>(null); const gallery = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; url: string; pdf: boolean; name: string } | null>(null); const [docRef, setDocRef] = useState<string | null>(null); const [uuid, setUuid] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "reading" | "review">("pick");
  const [dups, setDups] = useState<ScanResult["possible_duplicates"]>([]); const [hint, setHint] = useState<string | null>(null);
  const [f, setF] = useState({ date: "", amount: "", currency: "MXN", description: "", category: "", supplier: "", method: "", rfc: "" });
  const [paid, setPaid] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  void org;
  // ⌘V con una captura en la lista de gastos: abre el escáner y la lee como un gasto nuevo (si ya hay una lectura en curso o en revisión, no se pisa).
  usePasteImage((file) => { if (open && step !== "pick") return; if (!open) { reset(); setOpen(true); } void onFile(file); }, pasteEnabled && can("expense.manage"));
  if (!can("expense.manage")) return null;

  function reset() { if (image) URL.revokeObjectURL(image.url); setImage(null); setStep("pick"); setError(null); setDups([]); setHint(null); setDocRef(null); setPaid(true); setF({ date: "", amount: "", currency: "MXN", description: "", category: "", supplier: "", method: "", rfc: "" }); }

  async function onFile(file: File | undefined) {
    if (!file) return; setError(null);
    try {
      const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (pdf && file.size > 10 * 1024 * 1024) throw new ApiError(400, "Archivo grande", "El PDF excede 10 MB.");
      const blob = pdf ? file : await compress(file); const name = pdf ? file.name : "ticket.jpg";
      setImage({ blob, url: URL.createObjectURL(blob), pdf, name }); setStep("reading");
      const fd = new FormData(); fd.append("file", blob, name);
      const res = await fetch("/api/v1/expenses/scan", { method: "POST", body: fd, credentials: "same-origin" }); const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.title ?? "Error", data?.detail);
      const r = data as ScanResult, d = r.draft;
      setDups(r.possible_duplicates); setDocRef(r.document_reference); setUuid(d.fiscal_uuid ?? null);
      setHint(!d.is_receipt ? "No parece un ticket o comprobante. Revisa la foto." : d.notes ?? (d.confidence === "low" ? "Lectura poco segura: revisa cada dato." : null));
      setF({ date: d.date ?? "", amount: d.total_minor != null ? (d.total_minor / 100).toFixed(2) : "", currency: d.currency || "MXN", description: d.description || d.merchant || "", category: d.category ?? "", supplier: d.merchant ?? "", method: d.payment_method ?? "", rfc: d.merchant_tax_id ?? "" });
      setStep("review");
    } catch (e) { setError(err(e, "No se pudo leer la foto. Puedes capturar el gasto a mano.")); setStep("pick"); }
  }

  async function save() {
    if (!image) return; setBusy(true); setError(null);
    try {
      const exp = await api<{ id: string }>("/expenses", { body: { spent_at: f.date, description: f.description.trim(), category: f.category.trim() || undefined, amount_minor: toMinor(f.amount), currency: f.currency, supplier_name: f.supplier.trim() || undefined, external_reference: docRef ?? undefined, cfdi_uuid: uuid ?? undefined, ...(paid && can("payment.manage") ? { paid: { method: (f.method as "CASH" | "CARD" | "TRANSFER" | "OTHER") || "OTHER" } } : {}) } });
      const fd = new FormData(); fd.append("file", image.blob, image.name);
      await fetch(`/api/v1/expenses/${exp.id}/receipt`, { method: "POST", body: fd, credentials: "same-origin" }).catch(() => null); // el gasto ya existe: si la foto falla se puede adjuntar luego
      await onSaved(); setOpen(false); reset();
    } catch (e) { setError(err(e, "No se pudo guardar el gasto.")); } finally { setBusy(false); }
  }

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.description.trim() && Number(f.amount) > 0 && /^[A-Z]{3}$/.test(f.currency);
  return (
    <>
      <Button variant="outline" onClick={() => { reset(); setOpen(true); }}><ScanLine />Escanear ticket</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Escanear ticket o recibo</DialogTitle><DialogDescription>Toma una foto o sube un PDF (por ejemplo, el recibo de Vercel, Supabase o Resend). Leemos fecha, total, moneda y comercio; tú revisas y confirmas antes de guardar.</DialogDescription></DialogHeader>
        {step === "pick" && (
          <div className="space-y-3">
            {/* Dos entradas: con `capture` el iPhone abre solo la cámara; sin él ofrece fototeca, archivos y cámara. */}
            <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Tomar foto del ticket" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={gallery} type="file" accept="image/*,application/pdf,.pdf" className="sr-only" aria-label="Elegir foto o PDF" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => camera.current?.click()}><Camera />Tomar foto</Button>
              <Button variant="outline" onClick={() => gallery.current?.click()}><ImageIcon />Foto de galería o PDF</Button>
            </div>
            <p className="text-xs text-muted-foreground">Procura envía la imagen al servicio de lectura de Claude solo para extraer los datos. Procura nunca guarda un gasto sin que lo confirmes. Funciona mejor con el ticket completo, bien iluminado y sin dobleces.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>)}
        {step === "reading" && <div className="space-y-3 text-center text-sm"><div className="mx-auto h-48 w-40 animate-pulse rounded-lg bg-muted" /><p role="status">Leyendo el ticket…</p></div>}
        {step === "review" && image && (
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            {image.pdf ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-center text-xs text-muted-foreground"><FileText className="size-8" /><span className="break-all">{image.name}</span></div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), no una imagen servida
              <img src={image.url} alt="Foto del ticket" className="max-h-72 w-full rounded-lg border object-contain" />
            )}
            <div className="space-y-3">
              {hint && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{hint}</p>}
              {dups.length > 0 && <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">Ya hay un gasto con la misma fecha e importe: {dups.map((d) => <Link key={d.id} href="/gastos" className="underline">{d.description}</Link>)}. Verifica que no lo dupliques.</p>}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="s-date" className="text-xs">Fecha *</Label><Input id="s-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="s-amt" className="text-xs">Total *</Label><div className="flex gap-1"><Input id="s-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Input aria-label="Moneda" className="w-16 uppercase" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div></div>
              </div>
              <div className="space-y-1"><Label htmlFor="s-desc" className="text-xs">Descripción *</Label><Input id="s-desc" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="s-sup" className="text-xs">Comercio</Label><Input id="s-sup" maxLength={200} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="s-cat" className="text-xs">Categoría</Label><Input id="s-cat" maxLength={80} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
              </div>
              {can("payment.manage") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={paid} onChange={(e) => setPaid(e.target.checked)} /><span>Ya está pagado<span className="block text-xs text-muted-foreground">Un ticket o recibo normalmente ya se pagó. Si lo dejas sin marcar, queda en «Gastos por pagar».</span></span></label>}
              {(f.method || f.rfc) && <p className="text-xs text-muted-foreground">{f.method ? `Pago: ${PAYMENT_METHOD[f.method] ?? f.method}. ` : ""}{f.rfc ? `RFC del comercio: ${f.rfc}.` : ""}</p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          </div>)}
        <DialogFooter>
          {step === "review" && <Button variant="outline" onClick={reset} disabled={busy}>Otra foto</Button>}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          {step === "review" && <Button onClick={() => void save()} disabled={busy || !valid}>{busy ? "Guardando…" : "Guardar gasto"}</Button>}
        </DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}
