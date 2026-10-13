"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { dateTime } from "@/lib/format";
import { apiErr } from "@/components/app/finance-sections";

type Note = { id: string; body: string; author_name: string; created_at: string };

/** Bitácora del gasto: notas con fecha, hora y autor. Solo se agregan; no se editan ni se borran. */
export function ExpenseNotes({ expenseId, canWrite }: { expenseId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const key = ["expense-notes", expenseId];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ data: Note[] }>(`/expenses/${expenseId}/notes`) });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notes = q.data?.data ?? [];
  async function add() {
    setBusy(true); setError(null);
    try { await api(`/expenses/${expenseId}/notes`, { body: { body: text.trim() } }); setText(""); await qc.invalidateQueries({ queryKey: key }); }
    catch (er) { setError(apiErr(er, "No se pudo guardar la nota.")); } finally { setBusy(false); }
  }
  return (
    <section className="space-y-3">
      <h3 className="font-medium">Bitácora</h3>
      {canWrite && (
        <div className="space-y-2">
          <textarea aria-label="Nueva nota" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Anota lo que pasó: «el proveedor pidió reenviar el RFC», «prometieron la factura el lunes»…"
            className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end"><Button size="sm" onClick={add} disabled={busy || !text.trim()}>Agregar nota</Button></div>
        </div>
      )}
      {notes.length === 0 ? <p className="text-muted-foreground">Sin notas todavía.</p> : (
        <ul className="space-y-2">{notes.map((n) => (
          <li key={n.id} className="rounded-lg border px-3 py-2">
            <p className="whitespace-pre-wrap break-words">{n.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">{n.author_name} · {dateTime(n.created_at)}</p>
          </li>))}</ul>
      )}
    </section>
  );
}
