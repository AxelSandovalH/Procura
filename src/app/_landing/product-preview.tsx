import { StatusBadge } from "@/components/app/status-badge";

/** Maqueta estática de la app con DATOS DE EJEMPLO (no reales): gastos con y sin factura, para que se entienda de un vistazo qué ordena el producto. */
export function ProductPreview() {
  const rows = [
    { d: "Combustible", s: "Mobil · 11 oct", a: "$100.00", pay: ["Pagado", "ok"], cfdi: ["CFDI ligado", "ok"] },
    { d: "Software", s: "Hosting · 10 oct", a: "$468.46", pay: ["Pagado", "ok"], cfdi: ["CFDI ligado", "ok"] },
    { d: "Renta", s: "Oficina · 13 oct", a: "$8,200.00", pay: ["Pendiente de pago", "warn"], cfdi: ["Sin CFDI", "muted"] },
    { d: "Alimentos", s: "Ticket escaneado · 10 oct", a: "$120.00", pay: ["Pendiente de pago", "warn"], cfdi: ["Sin CFDI", "muted"] },
  ] as const;
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" role="img" aria-label="Ejemplo con datos ficticios: lista de gastos con su estado de pago y de factura">
      <div className="flex items-center justify-between gap-2"><p className="text-base font-semibold tracking-tight">Gastos del mes</p><span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Ejemplo</span></div>
      <div className="mt-4 overflow-hidden rounded-lg border text-sm">
        {rows.map((r) => (
          <div key={r.d} className="flex items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0">
            <div className="min-w-0"><p className="truncate font-medium">{r.d}</p><p className="truncate text-xs text-muted-foreground">{r.s}</p></div>
            <div className="flex shrink-0 flex-col items-end gap-1"><span className="tabular-nums font-medium">{r.a}</span><span className="flex flex-wrap justify-end gap-1"><StatusBadge label={r.pay[0]} tone={r.pay[1]} /><StatusBadge label={r.cfdi[0]} tone={r.cfdi[1]} /></span></div>
          </div>))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span className="text-muted-foreground">2 gastos sin factura por revisar</span><span className="font-medium">Todo en un solo lugar</span></div>
    </div>
  );
}
