import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { startApprovalRequest } from "@/lib/requisitions/approval-engine";

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

    const outcome = await startApprovalRequest(tx, r);
    const updated = await tx.requisitions.update({
      where: { id: r.id },
      data: outcome.status === "APPROVED"
        ? { status: "APPROVED", submitted_at: new Date(), approved_at: new Date(), approved_version: r.version }
        : { status: "PENDING_APPROVAL", submitted_at: new Date() },
    });
    await audit(tx, { ...auditBase(actor), action: "requisition.submitted", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio });
    if (outcome.status === "APPROVED") await audit(tx, { ...auditBase(actor), action: "requisition.approved", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, metadata: { auto: true } });
    return updated;
  });
  return NextResponse.json(requisition);
});
