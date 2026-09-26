"use client";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { PRIORITY, REQUISITION_STATUS } from "@/lib/ui/status";
import { dateShort, money } from "@/lib/format";

export interface RequisitionRow { id: string; folio: string; title: string; status: string; priority: string; required_date: string | null; created_at: string; currency: string; estimated_total_minor?: number | string }

export function RequisitionTable({ rows, showTotal }: { rows: RequisitionRow[]; showTotal: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Folio</TableHead><TableHead>Título</TableHead><TableHead>Estado</TableHead><TableHead>Prioridad</TableHead><TableHead>Requerida</TableHead>
          {showTotal && <TableHead className="text-right">Total estimado</TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = REQUISITION_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
            const pr = PRIORITY[r.priority] ?? { label: r.priority, tone: "neutral" as const };
            return (
              <TableRow key={r.id} className="cursor-pointer">
                <TableCell className="font-mono text-xs"><Link href={`/requisiciones/${r.id}`} className="hover:underline">{r.folio}</Link></TableCell>
                <TableCell className="max-w-xs truncate font-medium"><Link href={`/requisiciones/${r.id}`} className="hover:underline">{r.title}</Link></TableCell>
                <TableCell><StatusBadge {...st} /></TableCell>
                <TableCell><StatusBadge {...pr} /></TableCell>
                <TableCell className="text-muted-foreground">{dateShort(r.required_date)}</TableCell>
                {showTotal && <TableCell className="text-right tabular-nums">{money(r.estimated_total_minor, r.currency)}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
