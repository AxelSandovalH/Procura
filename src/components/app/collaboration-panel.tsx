"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Lock, Paperclip, Send, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateTime } from "@/lib/format";

type Anchor = "REQUISITION" | "RFQ" | "QUOTATION" | "ORDER" | "DELIVERY";
interface Message { id: string; body: string; author_organization_id: string; created_at: string }
interface Attachment { id: string; filename: string; mime_type: string; size_bytes: number | string; visibility: "INTERNAL" | "SHARED"; mine: boolean; created_at: string }

const size = (n: number | string) => { const b = Number(n); return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`; };

/**
 * Conversación compartida, notas internas y archivos de un recurso. Lo compartido lo ven ambas partes;
 * lo interno solo tu organización. Cada pestaña aparece solo si tienes el permiso correspondiente.
 */
export function CollaborationPanel({ anchorType, anchorId, counterpartName, allowShared = true }: { anchorType: Anchor; anchorId: string; counterpartName?: string; allowShared?: boolean }) {
  const s = useSession();
  const shared = allowShared && anchorType !== "REQUISITION" && s.can("conversation.shared.read");
  const internal = s.can("note.internal.read");
  const first = shared ? "shared" : internal ? "internal" : "files";
  return (
    <Card>
      <CardHeader><CardTitle>Colaboración</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue={first}>
          <TabsList>
            {shared && <TabsTrigger value="shared"><Users className="size-3.5" />Conversación</TabsTrigger>}
            {internal && <TabsTrigger value="internal"><Lock className="size-3.5" />Notas internas</TabsTrigger>}
            <TabsTrigger value="files"><Paperclip className="size-3.5" />Archivos</TabsTrigger>
          </TabsList>
          {shared && <TabsContent value="shared" className="pt-3"><Thread anchorType={anchorType} anchorId={anchorId} visibility="SHARED" counterpartName={counterpartName} /></TabsContent>}
          {internal && <TabsContent value="internal" className="pt-3"><Thread anchorType={anchorType} anchorId={anchorId} visibility="INTERNAL" /></TabsContent>}
          <TabsContent value="files" className="pt-3"><Files anchorType={anchorType} anchorId={anchorId} canShare={allowShared && anchorType !== "REQUISITION"} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Thread({ anchorType, anchorId, visibility, counterpartName }: { anchorType: Anchor; anchorId: string; visibility: "SHARED" | "INTERNAL"; counterpartName?: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ["thread", anchorType, anchorId, visibility];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => api<{ messages: Message[] }>(`/threads?anchor_type=${anchorType}&anchor_id=${anchorId}&visibility=${visibility}`), refetchInterval: 15_000 });
  const canPost = s.can(visibility === "SHARED" ? "conversation.shared.post" : "note.internal.post");
  const msgs = q.data?.messages ?? [];

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { await api("/threads", { body: { anchor_type: anchorType, anchor_id: anchorId, visibility, body: text.trim() } }); setText(""); await qc.invalidateQueries({ queryKey: key }); }
    catch (er) { setError(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo enviar."); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{visibility === "SHARED" ? `Lo que escribas aquí lo ve ${counterpartName ?? "la otra parte"}.` : "Solo lo ve tu organización."}</p>
      {q.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : msgs.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay mensajes.</p> : (
        <ul className="max-h-80 space-y-2 overflow-y-auto pr-1" aria-live="polite">{msgs.map((m) => {
          const mine = m.author_organization_id === s.org?.id;
          return (
            <li key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${mine ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`mt-1 text-[11px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{mine ? "Tú" : visibility === "SHARED" ? (counterpartName ?? "Contraparte") : "Compañero"} · {dateTime(m.created_at)}</p>
            </li>);
        })}</ul>)}
      {canPost && (
        <form onSubmit={send} className="space-y-2">
          <Textarea aria-label={visibility === "SHARED" ? "Mensaje" : "Nota interna"} rows={2} placeholder={visibility === "SHARED" ? "Escribe un mensaje…" : "Escribe una nota…"} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e); }} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={busy || !text.trim()}><Send />{busy ? "Enviando…" : "Enviar"}</Button>
        </form>)}
    </div>
  );
}

function Files({ anchorType, anchorId, canShare }: { anchorType: Anchor; anchorId: string; canShare: boolean }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ["attachments", anchorType, anchorId];
  const input = useRef<HTMLInputElement>(null);
  const [shareIt, setShareIt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => api<{ data: Attachment[] }>(`/attachments?anchor_type=${anchorType}&anchor_id=${anchorId}`) });
  const rows = q.data?.data ?? [];

  async function upload(file: File) {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("file", file); fd.set("anchor_type", anchorType); fd.set("anchor_id", anchorId); fd.set("visibility", canShare && shareIt ? "SHARED" : "INTERNAL");
    try {
      const res = await fetch("/api/v1/attachments", { method: "POST", body: fd, credentials: "same-origin" });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new ApiError(res.status, d?.title ?? "Error", d?.detail); }
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo subir el archivo."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function download(a: Attachment) {
    setError(null);
    try { const r = await api<{ download_url: string }>(`/attachments/${a.id}`); window.open(r.download_url, "_blank", "noopener"); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo descargar."); }
  }
  async function remove(a: Attachment) {
    setError(null);
    try { await api(`/attachments/${a.id}`, { method: "DELETE" }); await qc.invalidateQueries({ queryKey: key }); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo eliminar."); }
  }
  return (
    <div className="space-y-3">
      {q.isLoading ? <div className="h-12 animate-pulse rounded bg-muted" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Sin archivos.</p> : (
        <ul className="divide-y text-sm">{rows.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0"><p className="truncate font-medium">{a.filename}</p><p className="text-xs text-muted-foreground">{size(a.size_bytes)} · {dateTime(a.created_at)} · {a.mine ? "Tuyo" : "De la contraparte"}</p></div>
            <div className="flex shrink-0 items-center gap-1">
              <StatusBadge label={a.visibility === "SHARED" ? "Compartido" : "Interno"} tone={a.visibility === "SHARED" ? "info" : "muted"} />
              <Button size="icon-sm" variant="ghost" aria-label={`Descargar ${a.filename}`} onClick={() => void download(a)}><Download /></Button>
              {a.mine && s.can("attachment.delete_own") && <Button size="icon-sm" variant="ghost" aria-label={`Eliminar ${a.filename}`} onClick={() => void remove(a)}><Trash2 /></Button>}
            </div>
          </li>))}</ul>)}
      {s.can("attachment.upload") && (
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" className="sr-only" id={`up-${anchorId}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Paperclip />{busy ? "Subiendo…" : "Adjuntar archivo"}</Button>
          {canShare && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={shareIt} onChange={(e) => setShareIt(e.target.checked)} />Compartir con la contraparte</label>}
        </div>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
