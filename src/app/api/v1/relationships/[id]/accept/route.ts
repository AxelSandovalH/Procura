import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

/** Solo la contraparte de quien inició puede aceptar (quien inició ya expresó su aceptación al crearla). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.accept");

  const relationship = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (r.status !== "PENDING") throw Problem.conflict(`La relación está en estado ${r.status}, no PENDING`);
    if (r.initiated_by_organization_id === actor.organizationId) throw Problem.forbidden("Quien inicia la relación no puede aceptarla; debe hacerlo la contraparte");
    const updated = await tx.relationships.update({ where: { id: r.id }, data: { status: "ACTIVE", accepted_at: new Date(), accepted_by_membership_id: actor.membershipId } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "relationship.accepted", resourceType: "relationship", resourceId: r.id });
    return updated;
  });
  return NextResponse.json(relationship);
});
