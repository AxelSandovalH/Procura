import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { normalizeRow, rowLevel, type ColumnMapping } from "@/lib/catalog/normalize";
import { previewRows } from "@/lib/catalog/parse";
import type { Prisma } from "@prisma/client";

const Body = z.object({
  columns: z.object({
    sku: z.string().min(1), name: z.string().min(1),
    description: z.string().optional(), item_type: z.string().optional(), unit: z.string().optional(),
    price: z.string().optional(), category: z.string().optional(), is_active: z.string().optional(),
  }),
});

/** Aplica el mapeo de columnas: valida cada fila, guarda el resultado normalizado y deja el import en VALIDATED. */
export const PUT = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.import");
  const { columns } = await json(req, (d) => Body.parse(d));

  const imp = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_imports.findFirst({ where: { id: params.id, organization_id: actor.organizationId } }),
  );
  if (!imp) throw Problem.notFound();
  if (imp.status === "CONFIRMED") throw Problem.conflict("Esta importación ya fue confirmada");

  const detectedColumns = imp.detected_columns as string[];
  for (const [field, col] of Object.entries(columns)) {
    if (col && !detectedColumns.includes(col)) throw Problem.badRequest(`La columna "${col}" (${field}) no existe en el archivo`);
  }

  // Lookups fuera de la transacción principal de escritura para no alargarla más de lo necesario.
  const [units, categories] = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    Promise.all([
      tx.units_of_measure.findMany({ where: { OR: [{ organization_id: null }, { organization_id: actor.organizationId }] }, select: { id: true, code: true } }),
      tx.categories.findMany({ where: { organization_id: actor.organizationId }, select: { id: true, name: true } }),
    ]),
  );
  const unitByCode = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const existingSkus = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_items.findMany({ where: { organization_id: actor.organizationId }, select: { sku: true } }),
  );
  const existingSkuSet = new Set(existingSkus.map((i) => i.sku.toLowerCase()));

  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_import_rows.findMany({ where: { import_id: imp.id, organization_id: actor.organizationId }, orderBy: { row_number: "asc" } }),
  );

  const seenSkus = new Set<string>();
  const summary = { total: rows.length, ok: 0, warnings: 0, errors: 0, to_create: 0, to_update: 0, skipped: 0 };
  const preview: Record<string, unknown>[] = [];

  // Procesado en lotes con una transacción por lote: 5000 filas × update individual sería demasiado
  // para una sola transacción interactiva de Prisma; el lote mantiene la RLS activa sin bloquear la BD.
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      for (const row of batch) {
        const raw = row.raw as Record<string, string>;
        const { normalized, messages } = normalizeRow(raw, columns as ColumnMapping, { unitByCode, categoryByName });
        let level = rowLevel(messages);
        const skuKey = normalized.sku?.toLowerCase() ?? null;

        let action: "CREATE" | "UPDATE" | "SKIP" = "SKIP";
        if (level !== "ERROR" && skuKey) {
          if (seenSkus.has(skuKey)) {
            messages.push({ field: "sku", level: "ERROR", message: "SKU duplicado dentro del mismo archivo" });
            level = "ERROR";
          } else {
            seenSkus.add(skuKey);
            action = existingSkuSet.has(skuKey) ? "UPDATE" : "CREATE";
          }
        }

        summary[level === "OK" ? "ok" : level === "WARNING" ? "warnings" : "errors"]++;
        if (action === "CREATE") summary.to_create++;
        else if (action === "UPDATE") summary.to_update++;
        else summary.skipped++;

        await tx.catalog_import_rows.update({
          where: { import_id_row_number: { import_id: imp.id, row_number: row.row_number } },
          data: { normalized: normalized as unknown as Prisma.InputJsonValue, level, messages: messages as unknown as Prisma.InputJsonValue, action },
        });
        if (preview.length < 20) preview.push({ row_number: row.row_number, normalized, level, messages, action });
      }
    });
  }

  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await tx.catalog_imports.update({
      where: { id: imp.id },
      data: { status: "VALIDATED", column_mapping: columns as Prisma.InputJsonValue, summary: summary as Prisma.InputJsonValue },
    });
    await audit(tx, { ...auditBase(actor), action: "catalog_import.mapped", resourceType: "catalog_import", resourceId: imp.id, changes: summary as Prisma.InputJsonValue });
  });

  return NextResponse.json({ summary, rows_preview: preview });
});
