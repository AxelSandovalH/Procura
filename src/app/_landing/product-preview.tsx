import { Check } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";

/** Maqueta estática de la app (datos de ejemplo, no reales) para mostrar el comparativo de cotizaciones. */
export function ProductPreview() {
  const rows = [
    { c: "Ancla 15 kg", q: "2 PZA", a: "$850.00", b: "$790.00", best: "b" },
    { c: "Cabo de amarre 12 mm", q: "40 M", a: "$32.00", b: "$35.50", best: "a" },
  ];
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" role="img" aria-label="Ejemplo de comparativo de cotizaciones en Procura">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">REQ-00012</span>
        <StatusBadge label="Cotizando" tone="info" />
        <StatusBadge label="Normal" tone="neutral" />
      </div>
      <p className="mt-1.5 text-base font-semibold tracking-tight">Refacciones de cubierta</p>
      <div className="mt-4 overflow-hidden rounded-lg border text-sm">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] border-b bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Concepto</span><span className="text-right">Proveedor A</span><span className="text-right">Proveedor B</span>
        </div>
        {rows.map((r) => (
          <div key={r.c} className="grid grid-cols-[1.4fr_1fr_1fr] items-center border-b px-3 py-2.5 last:border-b-0">
            <div><p className="font-medium">{r.c}</p><p className="text-xs text-muted-foreground">{r.q}</p></div>
            <span className={`rounded-md px-2 py-1 text-right tabular-nums ${r.best === "a" ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : ""}`}>{r.a}</span>
            <span className={`rounded-md px-2 py-1 text-right tabular-nums ${r.best === "b" ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : ""}`}>{r.b}</span>
          </div>
        ))}
        <div className="grid grid-cols-[1.4fr_1fr_1fr] items-center border-t bg-muted/30 px-3 py-2.5 font-semibold">
          <span>Total</span><span className="text-right tabular-nums">$1,980.00</span><span className="text-right tabular-nums">$1,990.00</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Check className="size-3.5 text-emerald-600" />Menor precio por concepto resaltado</span>
        <span>Tú decides</span>
      </div>
    </div>
  );
}
