import { createHash } from "node:crypto";

export interface BankRow { posted_at: string; description: string; amount_minor: number; balance_minor: number | null; reference: string | null }
export interface ParsedStatement { rows: BankRow[]; skipped: number; columns: { date: string; description: string; amount: string }; warnings: string[] }

const MONTHS: Record<string, number> = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Divide el texto en filas respetando comillas; detecta el separador (coma, punto y coma o tabulador). */
export function splitCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const sample = lines.slice(0, 10).join("\n");
  const count = (c: string) => (sample.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) ?? []).length;
  const delim = [",", ";", "\t", "|"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
  return lines.map((line) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === delim) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    out.push(cur.trim()); return out;
  });
}

/** Fecha en dd/mm/aaaa, aaaa-mm-dd, dd-mmm-aaaa (ene, feb…) o dd/mm/aa → «AAAA-MM-DD», o null. */
export function parseDate(raw: string): string | null {
  const s = norm(raw).replace(/\s+\d{1,2}:\d{2}.*$/, "");
  let y: number, m: number, d: number, mt: RegExpMatchArray | null;
  if ((mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +mt[1]!; m = +mt[2]!; d = +mt[3]!; }
  else if ((mt = s.match(/^(\d{1,2})[-/. ]([a-z]{3,4})\.?[-/. ,]*(\d{2,4})$/)) && MONTHS[mt[2]!]) { d = +mt[1]!; m = MONTHS[mt[2]!]!; y = +mt[3]!; }
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) { d = +mt[1]!; m = +mt[2]!; y = +mt[3]!; }
  else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Importe en centavos (entero). Acepta «$1,234.50», «(100.00)», «100.00-», «-100.00». Vacío o ilegible → null. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s$]|MXN|USD/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  s = s.replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const [i = "0", f = ""] = s.split(".");
  const cents = Number(i || "0") * 100 + Number((f + "00").slice(0, 2));
  return neg ? -cents : cents;
}

const find = (head: string[], re: RegExp) => head.findIndex((h) => re.test(h));

/** Lee un estado de cuenta en CSV: detecta el encabezado, las columnas (fecha, descripción, cargo/abono o monto único) y los movimientos. */
export function parseBankCsv(text: string): ParsedStatement {
  const table = splitCsv(text);
  const warnings: string[] = [];
  const hi = table.findIndex((r) => { const h = r.map(norm); return h.some((c) => /^fecha/.test(c)) && h.some((c) => /(cargo|abono|retiro|deposito|monto|importe|debito|credito)/.test(c)); });
  if (hi < 0) throw new Error("No encontré el encabezado: necesito una columna de fecha y otra de monto (o cargos y abonos).");
  const head = table[hi]!.map(norm);
  const iDate = find(head, /^fecha/);
  const iDesc = (() => { const k = find(head, /(descripcion|concepto|detalle|movimiento|leyenda)/); return k >= 0 ? k : find(head, /(referencia|beneficiario)/); })();
  const iRef = find(head, /(referencia|folio|clave de rastreo|rastreo)/);
  const iOut = find(head, /(cargo|retiro|debito)/), iIn = find(head, /(abono|deposito|credito)/);
  const iAmt = find(head, /^(monto|importe)/), iBal = find(head, /saldo/);
  if (iDesc < 0) throw new Error("No encontré la columna de descripción o concepto.");
  if (iAmt < 0 && iOut < 0 && iIn < 0) throw new Error("No encontré la columna de monto, ni de cargos y abonos.");
  const rows: BankRow[] = []; let skipped = 0;
  for (const r of table.slice(hi + 1)) {
    const date = parseDate(r[iDate] ?? "");
    let amount: number | null = null;
    if (iOut >= 0 || iIn >= 0) {
      const out = iOut >= 0 ? parseAmount(r[iOut] ?? "") : null, inn = iIn >= 0 ? parseAmount(r[iIn] ?? "") : null;
      amount = (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0);
      if (!out && !inn) amount = null;
    } else amount = parseAmount(r[iAmt] ?? "");
    const description = (r[iDesc] ?? "").replace(/\s+/g, " ").trim();
    if (!date || amount === null || amount === 0 || !description) { if (r.some((c) => c)) skipped++; continue; }
    rows.push({ posted_at: date, description: description.slice(0, 300), amount_minor: amount, balance_minor: iBal >= 0 ? parseAmount(r[iBal] ?? "") : null, reference: iRef >= 0 && iRef !== iDesc ? ((r[iRef] ?? "").trim().slice(0, 120) || null) : null });
  }
  if (rows.length === 0) throw new Error("No encontré movimientos con fecha e importe válidos.");
  if (skipped > 0) warnings.push(`${skipped} línea${skipped > 1 ? "s" : ""} sin fecha o importe se omitieron.`);
  const signed = iAmt >= 0 && iOut < 0 && iIn < 0;
  if (signed && rows.every((r) => r.amount_minor > 0)) warnings.push("Todos los importes vienen positivos: si tu banco no marca los cargos con signo, no podré distinguir entradas de salidas. Revisa que haya columnas de cargos y abonos.");
  return { rows, skipped, columns: { date: table[hi]![iDate]!, description: table[hi]![iDesc]!, amount: iAmt >= 0 ? table[hi]![iAmt]! : `${iOut >= 0 ? table[hi]![iOut] : "—"} / ${iIn >= 0 ? table[hi]![iIn] : "—"}` }, warnings };
}

/** Llave de deduplicación: fecha + importe + descripción + número de ocurrencia dentro del archivo (dos cargos idénticos el mismo día son válidos). */
export function withDedupeKeys(rows: BankRow[]): (BankRow & { dedupe_key: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.posted_at}|${r.amount_minor}|${norm(r.description)}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { ...r, dedupe_key: createHash("sha1").update(`${base}|${n}`).digest("hex") };
  });
}
