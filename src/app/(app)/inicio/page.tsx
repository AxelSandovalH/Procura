"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, ClipboardList, Plus, Send } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { RequisitionTable, type RequisitionRow } from "@/components/app/requisition-table";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

function Stat({ href, icon: Icon, label, value, hint }: { href: string; icon: typeof CheckSquare; label: string; value: number | string; hint?: string }) {
  return (
    <Link href={href} className="group">
      <Card className="transition-colors group-hover:bg-muted/50"><CardContent className="flex items-center gap-4">
        <span className="flex size-10 items-center justify-center rounded-lg bg-secondary"><Icon className="size-5" /></span>
        <div><p className="text-2xl leading-none font-semibold tabular-nums">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      </CardContent></Card>
    </Link>
  );
}

export default function Inicio() {
  const session = useSession();
  const canRead = session.can("requisition.read");
  const reqs = useQuery({ queryKey: ["requisitions", ""], queryFn: () => api<{ data: RequisitionRow[] }>("/requisitions"), enabled: canRead });
  const pending = useQuery({ queryKey: ["approvals-pending"], queryFn: () => api<{ data: unknown[] }>("/approvals/pending"), enabled: session.can("requisition.approve") });
  const rows = reqs.data?.data ?? [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const first = session.me?.user.full_name.split(" ")[0];

  return (
    <>
      <PageHeader title={first ? `Hola, ${first}` : "Inicio"} description={session.org ? `Trabajas en ${session.org.display_name}.` : undefined}
        actions={session.can("requisition.create") ? <Link href="/requisiciones/nueva" className={cn(buttonVariants())}><Plus />Nueva requisición</Link> : undefined} />
      {canRead ? (<>
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {session.can("requisition.approve") && <Stat href="/aprobaciones" icon={CheckSquare} label="Por aprobar" value={pending.data?.data.length ?? "—"} />}
          <Stat href="/requisiciones?status=DRAFT" icon={ClipboardList} label="Borradores" value={reqs.isLoading ? "—" : count("DRAFT")} />
          <Stat href="/requisiciones?status=SENT" icon={Send} label="En cotización" value={reqs.isLoading ? "—" : count("SENT")} />
        </div>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recientes</h2><Link href="/requisiciones" className="text-sm text-muted-foreground hover:text-foreground">Ver todas</Link></div>
        {reqs.isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aún no hay requisiciones.</p> : <RequisitionTable rows={rows.slice(0, 5)} showTotal={session.can("requisition.read_private")} />}
      </>) : <p className="text-sm text-muted-foreground">Tu rol no incluye acceso a requisiciones. Pide a un administrador los permisos necesarios.</p>}
    </>
  );
}
