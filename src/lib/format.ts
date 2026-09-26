/** Montos: la API usa unidad menor (centavos) como entero; se muestran en la moneda del documento. */
export function money(minor: number | string | null | undefined, currency = "MXN"): string {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(Number(minor) / 100);
}
export function toMinor(amount: string | number): number {
  const n = typeof amount === "number" ? amount : Number(amount.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function dateShort(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
export function dateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function qty(n: string | number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 4 }).format(Number(n));
}
