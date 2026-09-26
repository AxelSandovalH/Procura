import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recordDecision } from "@/lib/requisitions/approval-engine";
import { emitEvent, notify } from "@/lib/events/emit";

const Body = z.object({ comment: z.string().trim().min(1).max(1000) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.membershipId) throw Problem.forbidden("Solo usuarios pueden solicitar cambios");
  const { comment } = await json(req, (d) => Body.parse(d));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    const outcome = await recordDecision(tx, r.id, actor.membershipId!, "REQUEST_CHANGES", comment, undefined);
    await audit(tx, { ...auditBase(actor), action: "requisition.changes_requested", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, reason: comment });
    await emitEvent(tx, { type: "requisition.changes_requested", aggregateType: "requisition", aggregateId: r.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { requisition: { id: r.id, folio: r.folio }, reason: comment } }] });
    if (r.requester_membership_id) await notify(tx, { organizationId: actor.organizationId, membershipIds: [r.requester_membership_id], type: "requisition.changes_requested", title: `Cambios solicitados en ${r.folio}`, body: comment, resourceType: "requisition", resourceId: r.id });
    return outcome;
  });
  return NextResponse.json(result);
});
