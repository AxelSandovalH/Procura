"use client";
import { useState } from "react";
import { money } from "@/lib/format";

/** Gráficas ligeras en SVG/CSS (sin librerías). Los colores son fijos y legibles en claro y oscuro; cada barra o sector tiene su valor exacto al pasar el cursor o enfocar. */
export const PALETTE = ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4", "#94a3b8"];
const compact = (minor: number) => new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(minor / 100);
const MONTH = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" });
const monthLabel = (ym: string) => MONTH.format(new Date(`${ym}-01T00:00:00Z`)).replace(".", "");

export interface Series { key: string; label: string; color: string }

/** Barras agrupadas por mes. `data[i][serie.key]` está en centavos. */
export function MonthlyBars({ data, series, currency, dense = false }: { data: ({ month: string } & Record<string, number | string>)[]; series: Series[]; currency: string; dense?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = dense ? 150 : 220, L = 44, B = dense ? 22 : 26, T = 10;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]))));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const gw = (W - L) / data.length, bw = Math.min(26, (gw - 14) / series.length);
  const empty = data.every((d) => series.every((s) => Number(d[s.key]) === 0));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">{series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Tendencia mensual">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={L} x2={W} y1={y(nice * t)} y2={y(nice * t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.3 : 0.1} /><text x={L - 6} y={y(nice * t) + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity={0.7}>{compact(nice * t)}</text></g>)}
        {data.map((d, i) => {
          const cx = L + gw * i + gw / 2, x0 = cx - (bw * series.length) / 2;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${monthLabel(d.month)}: ${series.map((s) => `${s.label} ${money(Number(d[s.key]), currency)}`).join(", ")}`}>
              <rect x={L + gw * i} y={T} width={gw} height={H - T - B} fill="currentColor" fillOpacity={hover === i ? 0.05 : 0} />
              {series.map((s, j) => { const v = Number(d[s.key]); const h = Math.max(v > 0 ? 2 : 0, y(0) - y(v)); return <rect key={s.key} x={x0 + bw * j + 1} y={y(0) - h} width={bw - 2} height={h} rx={3} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />; })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity={hover === i ? 0.95 : 0.7}>{monthLabel(d.month)}</text>
            </g>);
        })}
      </svg>
      <div className="min-h-5 text-xs" aria-live="polite">{hover !== null && !empty ? <span className="font-medium">{monthLabel(data[hover]!.month)}: {series.map((s) => `${s.label} ${money(Number(data[hover]![s.key]), currency)}`).join(" · ")}</span> : <span className="text-muted-foreground">{empty ? "Sin movimientos en estos 6 meses." : "Pasa el cursor sobre un mes para ver los importes."}</span>}</div>
    </div>
  );
}

/** Dona con leyenda; el centro muestra el total. */
export function Donut({ items, currency, centerLabel, dense = false }: { items: { label: string; total_minor: number }[]; currency: string; centerLabel: string; dense?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((s, i) => s + i.total_minor, 0);
  if (total <= 0) return <p className="py-8 text-center text-sm text-muted-foreground">Sin gastos en el periodo.</p>;
  const R = 52, C = 2 * Math.PI * R;
  const offsets = items.map((_, i) => items.slice(0, i).reduce((s, x) => s + (x.total_minor / total) * C, 0));
  const shown = hover !== null ? items[hover]! : null;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className={`${dense ? "size-32" : "size-40"} shrink-0 -rotate-90`} role="img" aria-label="Gastos por categoría">
        {items.map((it, i) => { const len = (it.total_minor / total) * C; return <circle key={it.label} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={hover === i ? 22 : 18} strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-offsets[i]!} opacity={hover === null || hover === i ? 1 : 0.4} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />; })}
        <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}>
          <text x="70" y="66" textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity={0.6}>{shown ? shown.label.slice(0, 16) : centerLabel}</text>
          <text x="70" y="82" textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor">{compact(shown ? shown.total_minor : total)}</text>
        </g>
      </svg>
      <ul className={`min-w-0 flex-1 text-sm ${dense ? "space-y-1" : "space-y-1.5"}`}>{items.map((it, i) => (
        <li key={it.label} className="flex items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="min-w-0 flex-1 truncate">{it.label}</span>
          <span className="tabular-nums text-muted-foreground">{Math.round((it.total_minor / total) * 100)}%</span><span className="w-24 text-right tabular-nums">{money(it.total_minor, currency)}</span></li>))}</ul>
    </div>
  );
}

/** Barras horizontales ordenadas (p. ej. principales proveedores). */
export function HBars({ items, currency, dense = false }: { items: { label: string; total_minor: number }[]; currency: string; dense?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.total_minor));
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Sin gastos en el periodo.</p>;
  return (
    <ul className={dense ? "space-y-1.5" : "space-y-2.5"}>{items.map((it, i) => (
      <li key={it.label}><div className={`flex items-baseline justify-between gap-3 text-sm ${dense ? "mb-0.5" : "mb-1"}`}><span className="min-w-0 truncate">{it.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{money(it.total_minor, currency)}</span></div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(3, (it.total_minor / max) * 100)}%`, background: PALETTE[i % PALETTE.length] }} /></div></li>))}</ul>
  );
}

/** Medidor: parte del gasto que ya está documentada con CFDI. */
export function Coverage({ withDoc, withoutDoc, currency }: { withDoc: number; withoutDoc: number; currency: string }) {
  const total = withDoc + withoutDoc; if (total <= 0) return <p className="py-8 text-center text-sm text-muted-foreground">Sin gastos en el periodo.</p>;
  const pct = Math.round((withDoc / total) * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2"><span className="text-4xl font-semibold tabular-nums">{pct}%</span><span className="pb-1 text-sm text-muted-foreground">del gasto ya tiene CFDI</span></div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% documentado`}><div className="bg-emerald-500" style={{ width: `${pct}%` }} /><div className="bg-amber-400" style={{ width: `${100 - pct}%` }} /></div>
      <div className="grid grid-cols-2 gap-3 text-sm"><p><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-emerald-500" />Con CFDI<br /><span className="font-medium tabular-nums">{money(withDoc, currency)}</span></p><p><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-amber-400" />Sin CFDI<br /><span className="font-medium tabular-nums">{money(withoutDoc, currency)}</span></p></div>
    </div>
  );
}
