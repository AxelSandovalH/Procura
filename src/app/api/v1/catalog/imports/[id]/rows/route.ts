import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import type { import_row_level } from "@prisma/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.import");
  const level = new URL(req.url).searchParams.get("level") as import_row_level | null;

  const imp = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_imports.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } }),
  );
  if (!imp) throw Problem.notFound();

  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_import_rows.findMany({
      where: { import_id: params.id, organization_id: actor.organizationId, ...(level ? { level } : {}) },
      orderBy: { row_number: "asc" },
      take: 500,
    }),
  );
  return NextResponse.json({ data: rows });
});
