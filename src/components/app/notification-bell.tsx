"use client";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import { dateTime } from "@/lib/format";

interface Notification { id: string; title: string; body: string | null; type: string; resource_type: string | null; resource_id: string | null; read_at: string | null; created_at: string }

/** Solo las entidades que ya tienen pantalla enlazan; el resto se marca leída sin navegar. */
function hrefFor(n: Notification): string | null {
  if (n.resource_type === "requisition" && n.resource_id) return `/requisiciones/${n.resource_id}`;
  return null;
}

export function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ data: Notification[] }>("/me/notifications"), refetchInterval: 30_000 });
  const items = data?.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({ mutationFn: (id: string) => api(`/me/notifications/${id}/read`, { method: "POST" }), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: () => api("/me/notifications/read-all", { method: "POST" }), onSuccess: refresh });

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`} className="relative" />}>
        <Bell />
        {unread > 0 && <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notificaciones</span>
          {unread > 0 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => markAll.mutate()}>Marcar todas como leídas</button>}
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Sin notificaciones</li>}
          {items.slice(0, 30).map((n) => {
            const href = hrefFor(n);
            return (
              <li key={n.id}>
                <button
                  className={`w-full border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted ${n.read_at ? "text-muted-foreground" : ""}`}
                  onClick={() => { if (!n.read_at) markRead.mutate(n.id); if (href) router.push(href); }}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-600" />}
                    <div className="min-w-0"><p className="text-sm leading-snug">{n.title}</p>{n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}<p className="mt-0.5 text-xs text-muted-foreground">{dateTime(n.created_at)}</p></div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
