import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().max(500).optional() });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.accept");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));

  const relationship = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (r.status !== "PENDING") throw Problem.conflict(`La relación está en estado ${r.status}, no PENDING`);
    if (r.initiated_by_organization_id === actor.organizationId) throw Problem.forbidden("Quien inicia la relación no puede rechazarla");
    const updated = await tx.relationships.update({ where: { id: r.id }, data: { status: "REJECTED", rejected_at: new Date(), rejected_reason: reason } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "relationship.rejected", resourceType: "relationship", resourceId: r.id, reason });
    return updated;
  });
  return NextResponse.json(relationship);
});
