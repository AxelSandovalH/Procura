"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app/page-header";
import { RequisitionTable, type RequisitionRow } from "@/components/app/requisition-table";
import { useSyncedState } from "@/hooks/use-synced-state";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { REQUISITION_STATUS } from "@/lib/ui/status";
import { cn } from "@/lib/utils";

const ALL = "ALL";

function List() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const status = params.get("status") ?? ALL;
  const q = params.get("q") ?? "";
  const [text, setText] = useSyncedState(() => q, q);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v && v !== ALL) next.set(k, v); else next.delete(k);
    router.replace(`/requisiciones${next.size ? `?${next}` : ""}`);
  };
  const qs = new URLSearchParams({ ...(status !== ALL ? { status } : {}), ...(q ? { q } : {}) }).toString();
  const { data, isLoading, error } = useQuery({ queryKey: ["requisitions", qs], queryFn: () => api<{ data: RequisitionRow[] }>(`/requisitions${qs ? `?${qs}` : ""}`) });
  const rows = data?.data ?? [];
  const showTotal = session.can("requisition.read_private");

  return (
    <>
      <PageHeader title="Requisiciones" description="Solicitudes de compra de tu organización."
        actions={session.can("requisition.create") ? <Link href="/comprar" className={cn(buttonVariants())}><Plus />Comprar</Link> : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        <form className="relative min-w-56 flex-1 sm:max-w-xs" onSubmit={(e) => { e.preventDefault(); setParam("q", text.trim() || null); }}>
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Buscar" placeholder="Buscar por folio o título" className="pl-8" value={text} onChange={(e) => setText(e.target.value)} />
        </form>
        <Select value={status} onValueChange={(v) => setParam("status", v)} items={[{ value: ALL, label: "Todos los estados" }, ...Object.entries(REQUISITION_STATUS).map(([value, v]) => ({ value, label: v.label }))]}>
          <SelectTrigger className="w-44" aria-label="Estado"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {Object.entries(REQUISITION_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== ALL || q) && <Button variant="ghost" onClick={() => router.replace("/requisiciones")}>Limpiar</Button>}
      </div>
      {error ? <p className="text-sm text-destructive">No se pudieron cargar las requisiciones.</p>
        : isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />)}</div>
        : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <p className="font-medium">{q || status !== ALL ? "Ninguna requisición coincide con el filtro" : "Aún no hay requisiciones"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{q || status !== ALL ? "Prueba con otros criterios." : "Crea la primera para empezar el flujo de compra."}</p>
          </div>
        ) : <RequisitionTable rows={rows} showTotal={showTotal} />}
    </>
  );
}

export default function RequisicionesPage() { return <Suspense><List /></Suspense>; }
