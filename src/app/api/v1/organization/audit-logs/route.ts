import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { loadAuditFeed } from "@/lib/audit-feed";
import type { Prisma } from "@prisma/client";

/** Bitácora de la organización (permiso `audit.read`). Filtros: resource_type, resource_id, actor (membership), from, to, limit. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "audit.read");
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : null; const to = sp.get("to") ? new Date(sp.get("to")!) : null;
  const where: Prisma.audit_logsWhereInput = {
    ...(sp.get("resource_type") ? { resource_type: sp.get("resource_type")! } : {}),
    ...(sp.get("resource_id") ? { resource_id: sp.get("resource_id")! } : {}),
    ...(sp.get("actor") ? { membership_id: sp.get("actor")! } : {}),
    ...(from && !isNaN(+from) || to && !isNaN(+to) ? { occurred_at: { ...(from && !isNaN(+from) ? { gte: from } : {}), ...(to && !isNaN(+to) ? { lte: to } : {}) } } : {}),
  };
  const limit = Math.min(Number(sp.get("limit")) || 100, 500);
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => loadAuditFeed(tx, actor.organizationId, where, limit, sp.get("all") === "1"));
  return NextResponse.json({ data });
});
