import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");

  const relationship = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (r.status !== "SUSPENDED") throw Problem.conflict(`La relación está en estado ${r.status}, no SUSPENDED`);
    const updated = await tx.relationships.update({ where: { id: r.id }, data: { status: "ACTIVE", suspended_at: null, suspended_by_organization_id: null, suspended_reason: null } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "relationship.reactivated", resourceType: "relationship", resourceId: r.id });
    return updated;
  });
  return NextResponse.json(relationship);
});
