import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";
import type { NormalizedRow } from "@/lib/catalog/normalize";

/** Aplica el import: upsert por SKU. Nunca borra; las filas con error quedan fuera (action=SKIP). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.import");

  const imp = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_imports.findFirst({ where: { id: params.id, organization_id: actor.organizationId } }),
  );
  if (!imp) throw Problem.notFound();
  if (imp.status === "CONFIRMED") throw Problem.conflict("Esta importación ya fue confirmada");
  if (imp.status !== "VALIDATED") throw Problem.conflict("Primero define el mapeo de columnas (PUT .../mapping)");

  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_import_rows.findMany({
      where: { import_id: imp.id, organization_id: actor.organizationId, action: { in: ["CREATE", "UPDATE"] } },
      orderBy: { row_number: "asc" },
    }),
  );

  let created = 0, updated = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      for (const row of batch) {
        const n = row.normalized as unknown as NormalizedRow;
        if (!n.sku || !n.name) continue;
        const data = {
          name: n.name,
          description: n.description,
          item_type: n.item_type,
          unit_id: n.unit_id,
          unit_label: n.unit_label ?? n.item_type,
          list_price_minor: n.list_price_minor != null ? BigInt(n.list_price_minor) : null,
          currency: n.currency,
          category_id: n.category_id,
          is_active: n.is_active,
        };
        const result = await tx.catalog_items.upsert({
          where: { organization_id_sku: { organization_id: actor.organizationId, sku: n.sku } },
          create: { organization_id: actor.organizationId, sku: n.sku, ...data },
          update: data,
        });
        if (row.action === "CREATE") created++; else updated++;
        void result;
      }
    });
  }

  const finalSummary = { ...(imp.summary as Record<string, unknown>), created, updated };
  const confirmed = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const updatedImport = await tx.catalog_imports.update({
      where: { id: imp.id },
      data: { status: "CONFIRMED", confirmed_at: new Date(), summary: finalSummary as Prisma.InputJsonValue },
    });
    await audit(tx, { ...auditBase(actor), action: "catalog_import.confirmed", resourceType: "catalog_import", resourceId: imp.id, changes: { created, updated } });
    return updatedImport;
  });

  return NextResponse.json(confirmed);
});
