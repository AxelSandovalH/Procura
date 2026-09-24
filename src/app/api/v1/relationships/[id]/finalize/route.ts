import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().max(500).optional() });
const LIVE_ORDER_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "IN_PROCESS"] as const;

/** Terminal. Bloqueada si hay órdenes vivas de esta relación (OD-13): primero hay que cerrarlas. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));

  const relationship = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (r.status !== "ACTIVE" && r.status !== "SUSPENDED") throw Problem.conflict(`La relación está en estado ${r.status}`);
    const liveOrders = await tx.orders.count({ where: { relationship_id: r.id, status: { in: [...LIVE_ORDER_STATUSES] } } });
    if (liveOrders > 0) throw Problem.conflict(`No se puede finalizar: hay ${liveOrders} orden(es) en curso`);
    const updated = await tx.relationships.update({ where: { id: r.id }, data: { status: "FINALIZED", finalized_at: new Date(), finalized_by_organization_id: actor.organizationId, finalized_reason: reason } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "relationship.finalized", resourceType: "relationship", resourceId: r.id, reason });
    return updated;
  });
  return NextResponse.json(relationship);
});
