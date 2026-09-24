import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.import");
  const imp = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_imports.findFirst({ where: { id: params.id, organization_id: actor.organizationId } }),
  );
  if (!imp) throw Problem.notFound();
  return NextResponse.json(imp);
});
