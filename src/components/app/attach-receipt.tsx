"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Adjunta al gasto el PDF (p. ej. una factura que llegó sin XML) o la foto de su comprobante. Queda interno y se ve en la vista previa del gasto. */
export function AttachReceiptButton({ expenseId }: { expenseId: string }) {
  const input = useRef<HTMLInputElement>(null); const qc = useQueryClient();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("El archivo excede 10 MB.");
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/v1/expenses/${expenseId}/receipt`, { method: "POST", body: fd, credentials: "same-origin" });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.detail ?? d?.title ?? "No se pudo subir el archivo."); }
      await qc.invalidateQueries({ queryKey: ["expense-receipts", expenseId] });
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo subir el archivo."); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return (
    <div className="space-y-1">
      <input ref={input} type="file" accept="application/pdf,.pdf,image/*" className="sr-only" aria-label="Elegir PDF o foto del comprobante" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Paperclip />{busy ? "Subiendo…" : "Adjuntar PDF o foto de la factura"}</Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
