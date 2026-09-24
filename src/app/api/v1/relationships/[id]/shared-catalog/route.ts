import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

interface SharedItemRow {
  id: string; sku: string; name: string; description: string | null; item_type: "GOOD" | "SERVICE";
  unit_label: string; category_id: string | null; list_price_minor: bigint | null; currency: string | null;
}

/**
 * Catálogo del proveedor visible al comprador (ítems compartidos + ítems de categorías compartidas).
 * catalog_items es INTERNAL (RLS por organización propia), así que la lectura cruzada vive en una
 * función SECURITY DEFINER (app.shared_catalog_items) que valida la relación y el share ella misma.
 */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("shared_catalog.read")) throw Problem.forbidden("Requiere el permiso shared_catalog.read");
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const categoryId = url.searchParams.get("category");

  const exists = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.relationships.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId, status: "ACTIVE" }, select: { id: true } }),
  );
  if (!exists) throw Problem.notFound();

  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.$queryRaw<SharedItemRow[]>`select * from app.shared_catalog_items(${params.id}::uuid, ${actor.organizationId}::uuid, ${categoryId}::uuid, ${q})`,
  );
  return NextResponse.json({ data: rows });
});
