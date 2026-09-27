"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { dateShort } from "@/lib/format";
import { RELATIONSHIP_STATUS } from "@/lib/ui/status";
import { cn } from "@/lib/utils";

interface Rel { id: string; status: string; position: "BUYER" | "SUPPLIER"; buyer: { display_name: string }; supplier: { display_name: string }; created_at: string; accepted_at: string | null }

export default function Relaciones() {
  const session = useSession();
  const [tab, setTab] = useState("SUPPLIER_OF_ME");
  const q = useQuery({ queryKey: ["relationships"], queryFn: () => api<{ data: Rel[] }>("/relationships") });
  // position = mi lado. Mis proveedores: yo soy BUYER. Mis clientes: yo soy SUPPLIER.
  const rows = (q.data?.data ?? []).filter((r) => (tab === "SUPPLIER_OF_ME" ? r.position === "BUYER" : r.position === "SUPPLIER"));
  return (
    <>
      <PageHeader title="Relaciones" description="Con quién compras y a quién le vendes. Toda cotización y orden viaja por una relación activa."
        actions={session.can("relationship.request") ? <Link href={`/relaciones/conectar?tipo=${tab === "SUPPLIER_OF_ME" ? "proveedor" : "cliente"}`} className={cn(buttonVariants())}><Plus />{tab === "SUPPLIER_OF_ME" ? "Conectar proveedor" : "Conectar cliente"}</Link> : undefined} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="mb-4">
        <TabsList><TabsTrigger value="SUPPLIER_OF_ME">Mis proveedores</TabsTrigger><TabsTrigger value="CLIENT_OF_ME">Mis clientes</TabsTrigger></TabsList>
      </Tabs>
      {q.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">{tab === "SUPPLIER_OF_ME" ? "Aún no tienes proveedores." : "Aún no tienes clientes."} {session.can("relationship.request") && <Link href={`/relaciones/conectar?tipo=${tab === "SUPPLIER_OF_ME" ? "proveedor" : "cliente"}`} className="font-medium text-foreground underline underline-offset-4">Conecta con {tab === "SUPPLIER_OF_ME" ? "uno" : "el primero"}</Link>}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Organización</TableHead><TableHead>Estado</TableHead><TableHead>Desde</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Link href={`/relaciones/${r.id}`} className="font-medium hover:underline">{r.position === "BUYER" ? r.supplier.display_name : r.buyer.display_name}</Link></TableCell>
              <TableCell><StatusBadge {...(RELATIONSHIP_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const })} /></TableCell>
              <TableCell className="text-muted-foreground">{dateShort(r.accepted_at ?? r.created_at)}</TableCell>
            </TableRow>))}</TableBody>
        </Table></div>
      )}
    </>
  );
}
