"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/ui/status";

interface Order { id: string; order_number: string; status: string; currency: string; total_minor: number | string; perspective: "BUYER" | "SUPPLIER"; buyer: { display_name: string }; supplier: { display_name: string }; created_at: string }

export default function Ordenes() {
  const [status, setStatus] = useState("ALL");
  const q = useQuery({ queryKey: ["orders", status], queryFn: () => api<{ data: Order[] }>(`/orders${status === "ALL" ? "" : `?status=${status}`}`) });
  const rows = q.data?.data ?? [];
  const items = [{ value: "ALL", label: "Todos los estados" }, ...Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))];
  return (
    <>
      <PageHeader title="Órdenes" description="Compras que haces y ventas que recibes." />
      <div className="mb-4">
        <Select items={items} value={status} onValueChange={(v) => setStatus(v ?? "ALL")}>
          <SelectTrigger className="w-52" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
          <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {q.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">No hay órdenes.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Tipo</TableHead><TableHead>Contraparte</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Creada</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((o) => (
            <TableRow key={o.id}>
              <TableCell><Link href={`/ordenes/${o.id}`} className="font-mono text-sm hover:underline">{o.order_number}</Link></TableCell>
              <TableCell className="text-muted-foreground">{o.perspective === "BUYER" ? "Compra" : "Venta"}</TableCell>
              <TableCell className="font-medium">{o.perspective === "BUYER" ? o.supplier.display_name : o.buyer.display_name}</TableCell>
              <TableCell><StatusBadge {...(ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const })} /></TableCell>
              <TableCell className="text-right tabular-nums">{money(o.total_minor, o.currency)}</TableCell>
              <TableCell className="text-muted-foreground">{dateShort(o.created_at)}</TableCell>
            </TableRow>))}</TableBody>
        </Table></div>
      )}
    </>
  );
}
