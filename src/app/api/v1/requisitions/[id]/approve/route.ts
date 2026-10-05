import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recordDecision } from "@/lib/requisitions/approval-engine";
import { emitEvent, notify } from "@/lib/events/emit";
import { autoIssueDirectedRfq } from "@/lib/sourcing/issue-rfq";
import { announceOrderCreated } from "@/lib/sourcing/order-events";

const Body = z.object({ comment: z.string().trim().max(1000).optional(), concept_id: z.uuid().optional() });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.membershipId) throw Problem.forbidden("Solo usuarios pueden aprobar");
  const { comment, concept_id } = await json(req, (d) => Body.parse(d ?? {}));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    const outcome = await recordDecision(tx, r.id, actor.membershipId!, "APPROVE", comment, concept_id);
    const finalApproval = outcome.requisitionStatus === "APPROVED" || outcome.requisitionStatus === "IN_PROCESS";
    const eventType = finalApproval ? "requisition.approved" : "requisition.approval_step_advanced";
    await audit(tx, { ...auditBase(actor), action: eventType, resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, reason: comment });
    await emitEvent(tx, { type: eventType, aggregateType: "requisition", aggregateId: r.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { requisition: { id: r.id, folio: r.folio, status: outcome.requisitionStatus } } }] });
    if (r.requester_membership_id && r.requester_membership_id !== actor.membershipId) {
      await notify(tx, { organizationId: actor.organizationId, membershipIds: [r.requester_membership_id], type: eventType, title: outcome.orderId ? `${r.folio} fue aprobada y se generó la orden` : finalApproval ? `${r.folio} fue aprobada` : `${r.folio} avanzó de nivel de aprobación`, resourceType: "requisition", resourceId: r.id });
    }
    if (outcome.orderId && outcome.quotationId) await announceOrderCreated(tx, actor, outcome.quotationId, outcome.orderId);
    const autoRfq = outcome.requisitionStatus === "APPROVED" ? await autoIssueDirectedRfq(tx, actor, r.id) : "SKIPPED";
    return autoRfq === "ISSUED" ? { ...outcome, requisitionStatus: "SENT" as const, auto_rfq_issued: true } : outcome;
  });
  return NextResponse.json(result);
});
