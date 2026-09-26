import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recordDecision } from "@/lib/requisitions/approval-engine";

const Body = z.object({ comment: z.string().trim().max(1000).optional(), concept_id: z.uuid().optional() });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.membershipId) throw Problem.forbidden("Solo usuarios pueden aprobar");
  const { comment, concept_id } = await json(req, (d) => Body.parse(d ?? {}));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    const outcome = await recordDecision(tx, r.id, actor.membershipId!, "APPROVE", comment, concept_id);
    await audit(tx, { ...auditBase(actor), action: outcome.requisitionStatus === "APPROVED" ? "requisition.approved" : "requisition.approval_step_advanced", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, reason: comment });
    return outcome;
  });
  return NextResponse.json(result);
});
