import { createHash } from "node:crypto";
import { splitCsv, parseAmount, parseDate } from "@/lib/bank/parse";
import type { Tx } from "@/lib/db/client";

/** Venta leída del archivo de un punto de venta. `total_minor` es lo que se cobró (el total del ticket). */
export interface PosRow { sold_at: string; total_minor: number; folio: string | null; description: string | null; method: "CASH" | "CARD" | "TRANSFER" | "OTHER" | null; customer: string | null }
export interface ParsedSales { rows: PosRow[]; skipped: { invalid: number; canceled: number; refunds: number }; columns: Record<string, string | null>; warnings: string[] }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const find = (head: string[], ...res: RegExp[]) => { for (const re of res) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) return i; } return -1; };

export function methodOf(raw: string | undefined): PosRow["method"] {
  const s = norm(raw ?? ""); if (!s) return null;
  if (/efectivo|cash/.test(s)) return "CASH"; if (/tarjeta|debito|credito|card|visa|master|amex/.test(s)) return "CARD"; if (/transfer|spei|deposito/.test(s)) return "TRANSFER"; return "OTHER";
}

/** Lee el CSV de ventas de un punto de venta: encabezado con fecha y total (y, si hay, folio del ticket, descripción, forma de pago, cliente y estatus). Nunca inventa datos que el archivo no trae. */
export function parseSalesCsv(text: string): ParsedSales {
  const table = splitCsv(text);
  const hi = table.findIndex((r) => { const h = r.map(norm); return h.some((c) => /^fecha/.test(c)) && h.some((c) => /^(total|importe|monto|venta)/.test(c)); });
  if (hi < 0) throw new Error("No encontré el encabezado: necesito una columna de fecha y otra de total (o importe).");
  const head = table[hi]!.map(norm), raw = table[hi]!;
  const iDate = find(head, /^fecha/), iTotal = find(head, /^total( de)?( la)?( venta| ticket)?$/, /^total/, /^(importe|monto|venta)/);
  const iFolio = find(head, /^(folio|ticket|no\.? ?(de )?ticket|n(u|ú)mero( de)? ticket|num(ero)?\.?$)/), iDesc = find(head, /(descripci|concepto|producto|detalle|articulo)/);
  const iMethod = head.findIndex((h, i) => i !== iTotal && !/total/.test(h) && /(forma de pago|metodo de pago|tipo de pago|^pago)/.test(h)), iStatus = find(head, /^(estatus|estado|status)/), iCust = find(head, /cliente/);
  const rows: PosRow[] = [], skipped = { invalid: 0, canceled: 0, refunds: 0 };
  for (const r of table.slice(hi + 1)) {
    if (!r.some((c) => c)) continue;
    if (iStatus >= 0 && /cancel/.test(norm(r[iStatus] ?? ""))) { skipped.canceled++; continue; }
    const date = parseDate(r[iDate] ?? ""), total = parseAmount(r[iTotal] ?? "");
    if (!date || total === null) { skipped.invalid++; continue; }
    if (total < 0) { skipped.refunds++; continue; }
    if (total === 0) { skipped.invalid++; continue; }
    rows.push({ sold_at: date, total_minor: total, folio: iFolio >= 0 ? (r[iFolio] ?? "").trim().slice(0, 40) || null : null, description: iDesc >= 0 ? (r[iDesc] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null : null, method: iMethod >= 0 ? methodOf(r[iMethod]) : null, customer: iCust >= 0 ? (r[iCust] ?? "").trim().slice(0, 200) || null : null });
  }
  if (rows.length === 0) throw new Error("No encontré ventas con fecha y total válidos.");
  const warnings: string[] = [];
  if (skipped.invalid) warnings.push(`${skipped.invalid} línea${skipped.invalid > 1 ? "s" : ""} sin fecha o total válido se omitieron.`);
  if (skipped.canceled) warnings.push(`${skipped.canceled} venta${skipped.canceled > 1 ? "s" : ""} cancelada${skipped.canceled > 1 ? "s" : ""} se omitieron.`);
  if (skipped.refunds) warnings.push(`${skipped.refunds} devolución${skipped.refunds > 1 ? "es" : ""} (importe negativo) se omitieron: regístralas aparte.`);
  if (iFolio < 0) warnings.push("El archivo no trae folio de ticket: cada venta recibirá un folio de ProcuraOS y no podrá buscarse por el folio de tu ticket (autofacturación).");
  return { rows, skipped, warnings, columns: { fecha: raw[iDate]!, total: raw[iTotal]!, folio: iFolio >= 0 ? raw[iFolio]! : null, descripcion: iDesc >= 0 ? raw[iDesc]! : null, forma_de_pago: iMethod >= 0 ? raw[iMethod]! : null, estatus: iStatus >= 0 ? raw[iStatus]! : null } };
}

/** Llave para no duplicar al reimportar: el folio del ticket; sin folio, fecha + importe + descripción + número de ocurrencia en el archivo. */
export function withRefs(rows: PosRow[]): (PosRow & { external_ref: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.folio) return { ...r, external_ref: `F:${r.folio.toUpperCase()}` };
    const base = `${r.sold_at}|${r.total_minor}|${norm(r.description ?? "")}`, n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { ...r, external_ref: `H:${createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 20)}` };
  });
}

/**
 * Separa el total de un ticket en subtotal e IVA de forma que subtotal + IVA sea EXACTAMENTE el total (el cliente teclea ese total en el portal de autofacturación).
 * `pct` = 0, 8 o 16 (el total ya incluye el IVA). Casi siempre existe un subtotal exacto; si no, el IVA absorbe el centavo de diferencia.
 */
export function splitTotal(total: number, pct: number): { base: number; tax: number; exact: boolean } {
  if (pct <= 0) return { base: total, tax: 0, exact: true };
  const guess = Math.round((total * 100) / (100 + pct));
  for (const d of [0, -1, 1, -2, 2]) { const base = guess + d; if (base > 0 && base + Math.round((base * pct) / 100) === total) return { base, tax: total - base, exact: true }; }
  return { base: guess, tax: total - guess, exact: false };
}


export interface ImportOptions { taxPercent: 0 | 8 | 16; markCollected: boolean; currency: string }
export interface ImportResult { created: number; duplicates: number; folio_conflicts: string[]; total_minor: number }
const CHUNK = 100;

/**
 * Crea las ventas del archivo, en bloques (una transacción por bloque). Idempotente: una venta cuyo folio de ticket (o huella) ya existe se cuenta como repetida y no se toca.
 * Si el folio del ticket ya lo usa OTRA venta (p. ej. capturada a mano), se informa y no se crea. Con `markCollected`, cada venta queda cobrada el día de la venta.
 */
export async function importSales(withTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>, organizationId: string, membershipId: string | null, rows: (PosRow & { external_ref: string })[], opts: ImportOptions): Promise<ImportResult> {
  const out: ImportResult = { created: 0, duplicates: 0, folio_conflicts: [], total_minor: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await withTx(async (tx) => {
      const refs = chunk.map((r) => r.external_ref), folios = chunk.map((r) => r.folio).filter((x): x is string => !!x);
      const have = new Set((await tx.sales.findMany({ where: { organization_id: organizationId, external_ref: { in: refs } }, select: { external_ref: true } })).map((s) => s.external_ref));
      const usedFolios = new Set((await tx.sales.findMany({ where: { organization_id: organizationId, folio: { in: folios } }, select: { folio: true } })).map((s) => s.folio));
      const fresh: typeof chunk = [];
      for (const r of chunk) {
        if (have.has(r.external_ref)) { out.duplicates++; continue; }
        if (r.folio && usedFolios.has(r.folio)) { out.folio_conflicts.push(r.folio); continue; }
        fresh.push(r);
      }
      if (fresh.length === 0) return;
      const withFolio: { r: (typeof chunk)[number]; folio: string }[] = [];
      for (const r of fresh) {
        const folio = r.folio ?? `VTA-${(await tx.$queryRaw<{ value: bigint }[]>`select app.next_sequence(${organizationId}::uuid, 'sale') as value`)[0]!.value.toString().padStart(5, "0")}`;
        withFolio.push({ r, folio });
      }
      const created = await tx.sales.createManyAndReturn({ data: withFolio.map(({ r, folio }) => {
        const s = splitTotal(r.total_minor, opts.taxPercent);
        return { organization_id: organizationId, folio, external_ref: r.external_ref, sold_at: new Date(r.sold_at), description: r.description ?? (r.folio ? `Ticket ${r.folio}` : `Ventas del ${r.sold_at}`), currency: opts.currency, subtotal_minor: BigInt(s.base), discount_minor: BigInt(0), tax_minor: BigInt(s.tax), total_minor: BigInt(r.total_minor), payment_method: r.method ?? undefined, notes: ["Importada del punto de venta", r.customer ? `Cliente: ${r.customer}` : null].filter(Boolean).join(" · "), collected_minor: opts.markCollected ? BigInt(r.total_minor) : BigInt(0), created_by_membership_id: membershipId };
      }), select: { id: true, folio: true } });
      const byFolio = new Map(created.map((c) => [c.folio, c.id]));
      await tx.sale_lines.createMany({ data: withFolio.map(({ r, folio }) => { const s = splitTotal(r.total_minor, opts.taxPercent); return { organization_id: organizationId, sale_id: byFolio.get(folio)!, line_number: 1, description: r.description ?? (r.folio ? `Ticket ${r.folio}` : `Ventas del ${r.sold_at}`), quantity: 1, unit_price_minor: BigInt(s.base), discount_minor: BigInt(0), tax_rate: opts.taxPercent / 100, tax_minor: BigInt(s.tax), total_minor: BigInt(r.total_minor) }; }) });
      if (opts.markCollected) await tx.payments.createMany({ data: withFolio.map(({ r, folio }) => ({ organization_id: organizationId, direction: "IN" as const, sale_id: byFolio.get(folio)!, paid_at: new Date(r.sold_at), amount_minor: BigInt(r.total_minor), currency: opts.currency, method: r.method ?? undefined, notes: "Cobro importado del punto de venta", created_by_membership_id: membershipId })) });
      out.created += created.length; out.total_minor += withFolio.reduce((s, { r }) => s + r.total_minor, 0);
    });
  }
  return out;
}
