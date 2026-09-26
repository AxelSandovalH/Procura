import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

/** Alternativa pull a los webhooks (API.md §11): cursor = id del último evento visto. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const since = sp.get("since");
  const types = sp.get("types")?.split(",").filter(Boolean);
  const limit = Math.min(Number(sp.get("limit") ?? 100), 500);

  const events = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.domain_events.findMany({
      where: { organization_id: actor.organizationId, ...(since ? { id: { gt: since } } : {}), ...(types?.length ? { type: { in: types } } : {}) },
      orderBy: { id: "asc" }, take: limit,
    }),
  );
  return NextResponse.json({
    data: events.map((e) => ({ id: e.id, type: e.type, version: e.schema_version, occurred_at: e.occurred_at, aggregate: { type: e.aggregate_type, id: e.aggregate_id }, actor: e.actor, organization_id: e.organization_id, perspective: e.perspective, data: e.payload })),
    next_cursor: events.length > 0 ? events[events.length - 1].id : since,
  });
});
