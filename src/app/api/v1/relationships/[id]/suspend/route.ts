import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent } from "@/lib/events/emit";

const Body = z.object({ reason: z.string().trim().max(500).optional() });

/** Bloquea SOLO operaciones nuevas (RFQ/cotización/orden); lo que ya está en curso continúa (OD-13). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));

  const relationship = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (r.status !== "ACTIVE") throw Problem.conflict(`La relación está en estado ${r.status}, no ACTIVE`);
    const updated = await tx.relationships.update({ where: { id: r.id }, data: { status: "SUSPENDED", suspended_at: new Date(), suspended_by_organization_id: actor.organizationId, suspended_reason: reason } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "relationship.suspended", resourceType: "relationship", resourceId: r.id, reason });
    await emitEvent(tx, { type: "relationship.suspended", aggregateType: "relationship", aggregateId: r.id, actor, recipients: [{ organizationId: r.buyer_organization_id, perspective: "BUYER" as const, payload: { relationship: { id: r.id, status: updated.status } } }, { organizationId: r.supplier_organization_id, perspective: "SUPPLIER" as const, payload: { relationship: { id: r.id, status: updated.status } } }] });
    return updated;
  });
  return NextResponse.json(relationship);
});
