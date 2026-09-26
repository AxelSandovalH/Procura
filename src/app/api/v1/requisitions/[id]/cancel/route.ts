import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });
const CANCELLABLE: readonly string[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"];

/** OD-30: el solicitante cancela las propias hasta APPROVED inclusive; Compras/Admin hasta SENT sin orden viva. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));

  const requisition = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    if (!CANCELLABLE.includes(r.status)) throw Problem.conflict(`No se puede cancelar en estado ${r.status}`);
    if (r.order_id) throw Problem.conflict("Existe una orden viva; cancélala primero");

    const isOwner = r.requester_membership_id === actor.membershipId;
    const ownerCanCancel = isOwner && actor.permissions.has("requisition.cancel") && (r.status === "DRAFT" || r.status === "PENDING_APPROVAL" || r.status === "APPROVED");
    const staffCanCancel = actor.permissions.has("requisition.cancel") && actor.permissions.has("requisition.update_any");
    if (!ownerCanCancel && !staffCanCancel) throw Problem.forbidden("No tienes permiso para cancelar esta requisición");

    await tx.approval_requests.updateMany({ where: { requisition_id: r.id, status: "PENDING" }, data: { status: "CANCELLED", completed_at: new Date() } });
    const updated = await tx.requisitions.update({ where: { id: r.id }, data: { status: "CANCELLED", cancelled_at: new Date(), cancelled_by_membership_id: actor.membershipId, cancel_reason: reason } });
    await audit(tx, { ...auditBase(actor), action: "requisition.cancelled", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, reason });
    return updated;
  });
  return NextResponse.json(requisition);
});
