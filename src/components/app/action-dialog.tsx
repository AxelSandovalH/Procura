"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";

interface Props {
  open: boolean; onOpenChange: (o: boolean) => void;
  title: string; description?: string;
  fieldLabel?: string; required?: boolean; confirmLabel: string; destructive?: boolean;
  onConfirm: (text: string) => Promise<unknown>;
}

/** Confirmación con motivo/comentario: los cambios de estado que exigen `reason` en la API lo piden aquí. */
export function ActionDialog({ open, onOpenChange, title, description, fieldLabel = "Comentario", required, confirmLabel, destructive, onConfirm }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(text.trim()); setText(""); onOpenChange(false); }
    catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="action-text">{fieldLabel}{!required && <span className="text-muted-foreground"> (opcional)</span>}</Label><Textarea id="action-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={go} disabled={busy || (required && !text.trim())}>{busy ? "Procesando…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
