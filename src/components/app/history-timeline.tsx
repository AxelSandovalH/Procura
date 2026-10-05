"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { dateTime } from "@/lib/format";
import { auditLabel } from "@/lib/ui/audit-labels";

interface Item {
  id: string; occurred_at: string; action: string; resource_label: string | null; reason: string | null;
  actor: { kind: "USER" | "API_KEY" | "SYSTEM"; name: string | null; organization: string | null };
}

function who(a: Item["actor"]) {
  if (a.kind === "SYSTEM") return "Procura (automático)";
  if (a.kind === "API_KEY") return "Integración (API)";
  return a.name ?? a.organization ?? "Un usuario";
}

/** Línea de tiempo: quién hizo qué, cuándo y con qué motivo. */
export function HistoryTimeline({ requisitionId }: { requisitionId: string }) {
  const q = useQuery({ queryKey: ["requisition-history", requisitionId], queryFn: () => api<{ data: Item[] }>(`/requisitions/${requisitionId}/history`) });
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (q.error) return <p className="text-sm text-destructive">No se pudo cargar el historial.</p>;
  const items = q.data?.data ?? [];
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Aún no hay movimientos.</p>;
  return (
    <ol className="relative space-y-5 border-l pl-5" aria-label="Historial de la solicitud">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-background bg-foreground/70" aria-hidden />
          <p className="text-sm"><span className="font-medium">{who(it.actor)}</span>{it.actor.kind === "USER" && it.actor.name && it.actor.organization ? <span className="text-muted-foreground"> · {it.actor.organization}</span> : null} {auditLabel(it.action)}
            {it.resource_label && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{it.resource_label}</span>}</p>
          {it.reason && <p className="mt-0.5 text-sm text-muted-foreground">“{it.reason}”</p>}
          <p className="mt-0.5 text-xs text-muted-foreground"><time dateTime={it.occurred_at}>{dateTime(it.occurred_at)}</time></p>
        </li>
      ))}
    </ol>
  );
}
