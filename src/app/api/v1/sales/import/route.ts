import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { importSales, parseSalesCsv, withRefs } from "@/lib/sales/import";

export const maxDuration = 60;
const MAX_ROWS = 1000;
const Body = z.object({ csv: z.string().min(10).max(5_000_000), dry_run: z.boolean().default(false), tax_percent: z.union([z.literal(0), z.literal(8), z.literal(16)]).default(16), mark_collected: z.boolean().default(true) });

/**
 * Importa las ventas de un punto de venta desde su archivo CSV (tickets, o un corte diario). Con `dry_run` solo muestra qué entraría. Reimportar el mismo archivo no duplica:
 * cada venta se identifica por el folio de su ticket. Las importadas conservan ese folio, para que el cliente pueda facturarlas en el portal de autofacturación.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const body = await json(req, (d) => Body.parse(d));
  if (body.mark_collected && !body.dry_run) authorize(actor, "payment.manage");
  let parsed; try { parsed = parseSalesCsv(body.csv); } catch (e) { throw Problem.badRequest((e as Error).message); }
  if (parsed.rows.length > MAX_ROWS) throw Problem.badRequest(`El archivo trae ${parsed.rows.length} ventas: importa máximo ${MAX_ROWS} por archivo (por ejemplo, una semana o un mes).`);
  const rows = withRefs(parsed.rows);
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const dates = rows.map((r) => r.sold_at).sort();
  const base = { rows: rows.length, from: dates[0], to: dates[dates.length - 1], total_minor: rows.reduce((s, r) => s + r.total_minor, 0), skipped: parsed.skipped, warnings: parsed.warnings, columns: parsed.columns, sample: rows.slice(0, 5).map((r) => ({ folio: r.folio, sold_at: r.sold_at, total_minor: r.total_minor, method: r.method })) };
  const currency = (await withContext(ctx, (tx) => tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { base_currency: true } }))).base_currency;
  if (body.dry_run) {
    const have = await withContext(ctx, (tx) => tx.sales.findMany({ where: { organization_id: actor.organizationId, external_ref: { in: rows.map((r) => r.external_ref) } }, select: { external_ref: true } }));
    const dup = new Set(have.map((h) => h.external_ref));
    return NextResponse.json({ ...base, duplicates: dup.size, new: rows.length - dup.size, currency });
  }
  const res = await importSales((fn) => withContext(ctx, fn), actor.organizationId, actor.membershipId, rows, { taxPercent: body.tax_percent, markCollected: body.mark_collected, currency });
  await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "sales.imported", resourceType: "organization", resourceId: actor.organizationId, metadata: { created: res.created, duplicates: res.duplicates, conflicts: res.folio_conflicts.length, total_minor: res.total_minor, from: base.from, to: base.to, tax_percent: body.tax_percent, collected: body.mark_collected } }));
  return NextResponse.json({ ...base, ...res, new: res.created, currency });
});
