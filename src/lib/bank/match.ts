/** Sugerencias de conciliación: puntúa gastos/ventas pendientes y pagos sin movimiento contra un movimiento bancario. Función pura. */
export interface Candidate { kind: "payment" | "expense" | "sale"; id: string; label: string; date: string; amount_minor: number; counterparty: string | null; payment_id?: string }
export interface Suggestion extends Candidate { score: number; reason: string }

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
