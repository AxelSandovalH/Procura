import { NextResponse } from "next/server";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { createRequisition, CreateRequisition } from "@/lib/requisitions/create";
import { requisitionVisibilityWhere } from "@/lib/requisitions/visibility";
import type { Prisma, requisition_status, requisition_priority, requisition_type } from "@prisma/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const visibility = requisitionVisibilityWhere(actor);
  if (visibility === null) throw Problem.forbidden("Requiere requisition.read");

  const url = new URL(req.url);
  const sp = url.searchParams;
  const status = sp.get("status") as requisition_status | null;
  const priority = sp.get("priority") as requisition_priority | null;
  const type = sp.get("type") as requisition_type | null;
  const q = sp.get("q");

  const where: Prisma.requisitionsWhereInput = {
    ...visibility,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(type ? { requisition_type: type } : {}),
    ...(sp.get("folio") ? { folio: { contains: sp.get("folio")!, mode: "insensitive" } } : {}),
    ...(sp.get("department_id") ? { department_id: sp.get("department_id") } : {}),
    ...(sp.get("location_id") ? { location_id: sp.get("location_id") } : {}),
    ...(sp.get("requester_id") ? { requester_membership_id: sp.get("requester_id") } : {}),
    ...(sp.get("supplier_organization_id") ? { OR: [{ suggested_supplier_organization_id: sp.get("supplier_organization_id") }, { directed_supplier_organization_id: sp.get("supplier_organization_id") }] } : {}),
  };

  // Búsqueda de texto: search_vector es tsvector (Unsupported en Prisma) → se resuelve a ids con SQL.
  // Solo letras/dígitos por token (sin operadores de tsquery del usuario), prefijo en cada uno.
  const tokens = (q ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).slice(0, 8);

  const canSeePrivate = actor.permissions.has("requisition.read_private");
  const requisitions = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    if (tokens.length > 0) {
      const tsquery = tokens.map((t) => `${t}:*`).join(" & ");
      const hits = await tx.$queryRaw<{ id: string }[]>`select id from requisitions where search_vector @@ to_tsquery('spanish', ${tsquery}) limit 500`;
      where.AND = [{ id: { in: hits.map((h) => h.id) } }]; // AND: nunca pisar el filtro de visibilidad
    }
    return tx.requisitions.findMany({ where, orderBy: { created_at: "desc" }, take: 100 });
  });
  // Mismos campos privados que oculta el detalle: presupuesto y total estimado requieren requisition.read_private.
  return NextResponse.json({ data: requisitions.map(({ budget_max_minor, estimated_total_minor, ...r }) => canSeePrivate ? { ...r, budget_max_minor, estimated_total_minor } : r) });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.create");
  const body = await json(req, (d) => CreateRequisition.parse(d));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    return createRequisition(tx, actor, body);
  });

  return NextResponse.json(result, { status: 201 });
});
