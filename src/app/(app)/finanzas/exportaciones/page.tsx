"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const month = (offset: number) => { const n = new Date(); return { from: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1))), to: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset + 1, 0))) }; };
const EXPORTS: { type: string; title: string; text: string; ext: "CSV" | "ZIP" }[] = [
  { type: "gastos", title: "Gastos", text: "Cada gasto con proveedor, categoría, monto, pagado y pendiente, estado de pago y de CFDI, y el UUID de su factura.", ext: "CSV" },
  { type: "ventas", title: "Ventas", text: "Cada venta con cliente y RFC, subtotal, IVA, total, retenciones, cobrado, por cobrar y el UUID de su factura.", ext: "CSV" },
  { type: "pagos", title: "Pagos y cobros", text: "Los pagos de gastos y los cobros de ventas por fecha, con método y referencia.", ext: "CSV" },
  { type: "cfdi_emitidos", title: "CFDI emitidos", text: "Tus facturas emitidas: UUID, receptor, subtotal, IVA, retenciones, total, forma y método de pago, y estado ante el SAT.", ext: "CSV" },
  { type: "cfdi_recibidos", title: "CFDI recibidos", text: "Las facturas que te emitieron, con los mismos datos fiscales y el importe ya ligado a tus gastos.", ext: "CSV" },
  { type: "banco", title: "Movimientos bancarios", text: "Los movimientos importados de tus estados de cuenta, con cargo, abono, saldo y estado de conciliación.", ext: "CSV" },
  { type: "xml_emitidos", title: "XML de CFDI emitidos", text: "Un ZIP con los XML de tus facturas emitidas del periodo, más un índice. Hasta 150 por descarga.", ext: "ZIP" },
  { type: "xml_recibidos", title: "XML de CFDI recibidos", text: "Un ZIP con los XML de las facturas recibidas del periodo, más un índice. Hasta 150 por descarga.", ext: "ZIP" },
];

/** Exportaciones para el equipo contable: CSV compatibles con Excel y ZIP de XML, por periodo. */
export default function Exportaciones() {
  const session = useSession();
  const [range, setRange] = useState(month(0));
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  if (!session.can("finance.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para exportar información financiera.</p>;
  async function download(type: string) {
    setBusy(type); setError(null);
    try {
      const res = await fetch(`/api/v1/finance/export?type=${type}&from=${range.from}&to=${range.to}`, { credentials: "same-origin" });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.detail ?? j?.title ?? "No se pudo generar la exportación."); }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `procura-${type}.csv`;
      const url = URL.createObjectURL(await res.blob()); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <>
      <PageHeader title="Exportaciones" description="Información para tu equipo contable, por periodo. Los CSV abren directo en Excel." />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="x-from" className="text-xs">Desde</Label><Input id="x-from" type="date" className="w-40" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="x-to" className="text-xs">Hasta</Label><Input id="x-to" type="date" className="w-40" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
        <div className="flex gap-2 pb-0.5"><Button variant="outline" size="sm" onClick={() => setRange(month(0))}>Este mes</Button><Button variant="outline" size="sm" onClick={() => setRange(month(-1))}>Mes anterior</Button><Button variant="outline" size="sm" onClick={() => { const y = new Date().getUTCFullYear(); setRange({ from: `${y}-01-01`, to: iso(new Date()) }); }}>Año en curso</Button></div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {EXPORTS.map((x) => (
          <Card key={x.type}><CardContent className="flex h-full flex-col justify-between gap-3 pt-5">
            <div><p className="font-medium">{x.title} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{x.ext}</span></p><p className="mt-1 text-sm text-muted-foreground">{x.text}</p></div>
            <Button variant="outline" disabled={!!busy || !range.from || !range.to} onClick={() => void download(x.type)}><Download />{busy === x.type ? "Generando…" : "Descargar"}</Button>
          </CardContent></Card>))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Cada exportación queda registrada en la bitácora. Los montos van en pesos, sin separadores, y las fechas como AAAA-MM-DD.</p>
    </>
  );
}
