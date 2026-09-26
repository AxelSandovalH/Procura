"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { dateShort } from "@/lib/format";
import { RFQ_STATUS } from "@/lib/ui/status";

interface Rfq { id: string; rfq_number: string; status: string; due_date: string | null; required_date: string | null; perspective: "BUYER" | "SUPPLIER"; buyer: { display_name: string }; supplier: { display_name: string }; created_at: string }

export default function Solicitudes() {
  const q = useQuery({ queryKey: ["rfqs"], queryFn: () => api<{ data: Rfq[] }>("/rfqs") });
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title="Solicitudes de cotización" description="Las que recibes de tus clientes y las que envías a tus proveedores." />
      {q.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">No hay solicitudes todavía.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Tipo</TableHead><TableHead>Contraparte</TableHead><TableHead>Estado</TableHead><TableHead>Responder antes de</TableHead><TableHead>Recibida</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Link href={`/solicitudes/${r.id}`} className="font-mono text-sm hover:underline">{r.rfq_number}</Link></TableCell>
              <TableCell className="text-muted-foreground">{r.perspective === "SUPPLIER" ? "Recibida" : "Enviada"}</TableCell>
              <TableCell className="font-medium">{r.perspective === "SUPPLIER" ? r.buyer.display_name : r.supplier.display_name}</TableCell>
              <TableCell><StatusBadge {...(RFQ_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const })} /></TableCell>
              <TableCell>{dateShort(r.due_date)}</TableCell><TableCell className="text-muted-foreground">{dateShort(r.created_at)}</TableCell>
            </TableRow>))}</TableBody>
        </Table></div>
      )}
    </>
  );
}
