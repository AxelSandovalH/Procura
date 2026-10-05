import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const requisition = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    const isOwner = r.requester_membership_id === actor.membershipId;
    if (!(isOwner || actor.permissions.has("requisition.update_any"))) throw Problem.forbidden();
    if (r.status !== "PENDING_APPROVAL") throw Problem.conflict(`No se puede retirar en estado ${r.status}`);

    // Si la aprobación era de una compra elegida (aprobar después de cotizar) la requisición vuelve a «Cotizando»; si no, a borrador.
    const pending = await tx.approval_requests.findFirst({ where: { requisition_id: r.id, status: "PENDING" }, select: { quotation_id: true } });
    await tx.approval_requests.updateMany({ where: { requisition_id: r.id, status: "PENDING" }, data: { status: "CANCELLED", completed_at: new Date() } });
    const updated = await tx.requisitions.update({ where: { id: r.id }, data: { status: pending?.quotation_id ? "SENT" : "DRAFT" } });
    await audit(tx, { ...auditBase(actor), action: "requisition.withdrawn", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio });
    return updated;
  });
  return NextResponse.json(requisition);
});
