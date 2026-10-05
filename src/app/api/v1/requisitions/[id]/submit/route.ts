import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { submitRequisition } from "@/lib/requisitions/submit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);

  const requisition = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    const isOwner = r.requester_membership_id === actor.membershipId;
    if (!((isOwner && actor.permissions.has("requisition.submit")) || actor.permissions.has("requisition.update_any"))) {
      throw Problem.forbidden("No tienes permiso para enviar esta requisición");
    }
    if (r.status !== "DRAFT") throw Problem.conflict(`No se puede enviar en estado ${r.status}`);
    const conceptCount = await tx.requisition_concepts.count({ where: { requisition_id: r.id } });
    if (conceptCount === 0) throw Problem.badRequest("La requisición debe tener al menos un concepto");

    return submitRequisition(tx, actor, r);
  });
  return NextResponse.json(requisition);
});
