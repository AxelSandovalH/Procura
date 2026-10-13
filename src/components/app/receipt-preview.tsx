"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

interface Att { id: string; filename: string; mime_type: string }

/** Vista previa del ticket o recibo adjunto a un gasto: miniatura (imagen) o visor (PDF); al pulsar la imagen se amplía. */
export function ReceiptPreview({ expenseId }: { expenseId: string }) {
  const list = useQuery({ queryKey: ["expense-receipts", expenseId], queryFn: () => api<{ data: Att[] }>(`/attachments?anchor_type=EXPENSE&anchor_id=${expenseId}`) });
  const files = list.data?.data ?? [];
  if (files.length === 0) return null;
  return <div className="space-y-2">{files.map((f) => <One key={f.id} file={f} />)}</div>;
}

function One({ file }: { file: Att }) {
  const [zoom, setZoom] = useState(false);
  const isPdf = file.mime_type === "application/pdf";
  // URL firmada de corta vida: se vuelve a pedir si la pestaña estuvo abierta un rato.
  const q = useQuery({ queryKey: ["attachment-preview", file.id], queryFn: () => api<{ preview_url?: string; download_url: string }>(`/attachments/${file.id}?inline=1`), staleTime: 4 * 60_000, gcTime: 4 * 60_000 });
  const url = q.data?.preview_url ?? q.data?.download_url;
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-label="Cargando ticket" />;
  if (!url) return <p className="text-xs text-muted-foreground">No se pudo cargar la vista previa de {file.filename}.</p>;
  return (
    <figure className="space-y-1">
      <figcaption className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex min-w-0 items-center gap-1.5"><FileText className="size-3.5 shrink-0" aria-hidden /><span className="truncate">Ticket · {file.filename}</span></span><a href={url} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 underline"><ExternalLink className="size-3" aria-hidden />Abrir</a></figcaption>
      {isPdf
        ? <iframe src={url} title={`Vista previa de ${file.filename}`} className="h-72 w-full rounded-lg border bg-white" />
        : (
          <>
            <button type="button" onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-lg border bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Ampliar ${file.filename}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, no una imagen estática del sitio */}
              <img src={url} alt={`Ticket ${file.filename}`} className="mx-auto max-h-64 w-auto object-contain" loading="lazy" />
            </button>
            <Dialog open={zoom} onOpenChange={setZoom}><DialogContent className="max-h-[92vh] overflow-auto sm:max-w-3xl">
              <DialogHeader><DialogTitle>Ticket</DialogTitle><DialogDescription className="break-all">{file.filename}</DialogDescription></DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
              <img src={url} alt={`Ticket ${file.filename} ampliado`} className="mx-auto h-auto max-w-full" />
            </DialogContent></Dialog>
          </>)}
    </figure>
  );
}
