"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { RequisitionTable, type RequisitionRow } from "@/components/app/requisition-table";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";

export default function AprobacionesPage() {
  const session = useSession();
  const { data, isLoading, error } = useQuery({ queryKey: ["approvals-pending"], queryFn: () => api<{ data: { requisition: RequisitionRow; level: number }[] }>("/approvals/pending"), enabled: session.can("requisition.approve") });
  const rows = (data?.data ?? []).map((d) => d.requisition);

  if (!session.can("requisition.approve")) return <p className="text-sm text-muted-foreground">No tienes permiso para aprobar requisiciones.</p>;
  return (
    <>
      <PageHeader title="Aprobaciones" description="Requisiciones que esperan tu decisión." />
      {error ? <p className="text-sm text-destructive">No se pudo cargar la bandeja.</p>
        : isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />)}</div>
        : rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><CheckCircle2 className="mb-2 size-8 text-emerald-600" /><p className="font-medium">Todo al día</p><p className="mt-1 text-sm text-muted-foreground">No tienes aprobaciones pendientes. Revisa el <Link href="/requisiciones" className="underline">listado de requisiciones</Link>.</p></div>
        ) : <RequisitionTable rows={rows} showTotal={session.can("requisition.read_private")} />}
    </>
  );
}
