/** Sugerencias de conciliación: puntúa gastos/ventas pendientes y pagos sin movimiento contra un movimiento bancario. Función pura. */
export interface Candidate { kind: "payment" | "expense" | "sale"; id: string; label: string; date: string; amount_minor: number; counterparty: string | null; payment_id?: string; currency?: string }
export interface Suggestion extends Candidate { score: number; reason: string; fx?: { currency: string; original_minor: number; rate: number } }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["compra", "pago", "cargo", "abono", "spei", "transferencia", "terminal", "tarjeta", "sa", "de", "cv", "sapi", "los", "las", "del", "con", "por", "para", "mx", "mex", "ref", "tpv"]);
const tokens = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)));
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export function suggest(txn: { posted_at: string; description: string; amount_minor: number }, candidates: Candidate[], max = 3): Suggestion[] {
  const want = Math.abs(txn.amount_minor); const tt = tokens(txn.description);
  const out: Suggestion[] = [];
  for (const c of candidates) {
    if (c.amount_minor !== want) continue; // el importe tiene que coincidir exacto; una conciliación parcial se hace a mano
    const dd = dayDiff(txn.posted_at, c.date);
    let score = 60; const why = ["mismo importe"];
    if (dd <= 1) { score += 25; why.push("misma fecha"); } else if (dd <= 4) { score += 18; why.push(`${Math.round(dd)} días de diferencia`); } else if (dd <= 14) { score += 8; why.push(`${Math.round(dd)} días de diferencia`); } else if (dd > 45) continue;
    const ct = tokens(`${c.counterparty ?? ""} ${c.label}`); const hit = [...tt].filter((t) => ct.has(t));
    if (hit.length) { score += Math.min(15, 8 * hit.length); why.push(`coincide «${hit[0]}»`); }
    if (c.kind === "payment") score += 3; // ya hay un pago registrado: solo falta confirmarlo contra el banco
    out.push({ ...c, score: Math.min(score, 100), reason: why.join(" · ") });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/**
 * Gastos en otra moneda (p. ej. USD) como posible origen de un cargo en la moneda de la cuenta: el importe NO coincide (lo fija el tipo de cambio del banco),
 * así que se puntúa por cercanía de fecha y por nombre, y se muestra el tipo de cambio implícito (cargo ÷ importe del gasto) para que la persona decida.
 * En cuentas en pesos se descartan tipos de cambio absurdos (fuera de 10–40) para no ofrecer gastos que no pueden ser.
 */
export function suggestForeign(txn: { posted_at: string; description: string; amount_minor: number }, accountCurrency: string, candidates: Candidate[], max = 3): Suggestion[] {
  const charged = Math.abs(txn.amount_minor); const tt = tokens(txn.description); const out: Suggestion[] = [];
  for (const c of candidates) {
    if (!c.currency || c.currency === accountCurrency || c.amount_minor <= 0) continue;
    const rate = charged / c.amount_minor;
    if (accountCurrency === "MXN" && (rate < 10 || rate > 40)) continue;
    const signed = (Date.parse(txn.posted_at) - Date.parse(c.date)) / 86_400_000; // + = el cargo llegó después del gasto
    if (signed < -5 || signed > 30) continue;
    let score = 30; const why = [`gasto en ${c.currency}`, `tipo de cambio implícito ${rate.toFixed(2)}`];
    const dd = Math.abs(signed);
    if (dd <= 2) { score += 30; why.push("misma fecha"); } else if (dd <= 7) { score += 20; why.push(`${Math.round(dd)} días de diferencia`); } else if (dd <= 14) { score += 10; why.push(`${Math.round(dd)} días de diferencia`); } else why.push(`${Math.round(dd)} días de diferencia`);
    const ct = tokens(`${c.counterparty ?? ""} ${c.label}`); const hit = [...tt].filter((t) => ct.has(t));
    if (hit.length) { score += Math.min(30, 15 * hit.length); why.push(`coincide «${hit[0]}»`); }
    out.push({ ...c, score: Math.min(score, 90), reason: why.join(" · "), fx: { currency: c.currency, original_minor: c.amount_minor, rate: Math.round(rate * 10000) / 10000 } });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
