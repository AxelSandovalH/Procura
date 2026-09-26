import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";
import { maybeTriggerReapproval } from "@/lib/requisitions/approval-engine";
import type { Prisma, requisitions } from "@prisma/client";

async function checkEditable(tx: Tx, requisitionId: string, actor: { membershipId: string | null; permissions: Set<string> }): Promise<requisitions> {
  const r = await tx.requisitions.findFirstOrThrow({ where: { id: requisitionId } }).catch(() => { throw Problem.notFound(); });
  const isOwner = r.requester_membership_id === actor.membershipId;
  const canEditOwn = isOwner && actor.permissions.has("requisition.update") && r.status === "DRAFT";
  const canEditAny = actor.permissions.has("requisition.update_any");
  if (!canEditOwn && !canEditAny) throw Problem.forbidden("No tienes permiso para editar esta requisición");
  if (r.status !== "DRAFT" && r.status !== "APPROVED") throw Problem.conflict(`No se puede editar en estado ${r.status}`);
  return r;
}

const Update = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  quantity: z.number().positive().optional(),
  unit_label: z.string().trim().min(1).max(40).optional(),
  estimated_unit_price_minor: z.number().int().min(0).nullable().optional(),
  budget_minor: z.number().int().min(0).nullable().optional(),
  required_date: z.iso.date().nullable().optional(),
  location_id: z.uuid().nullable().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await checkEditable(tx, params.id, actor);
    const before = await tx.requisition_concepts.findFirst({ where: { id: params.cid, requisition_id: r.id } });
    if (!before) throw Problem.notFound();

    const { specifications, ...rest } = body;
    const after = await tx.requisition_concepts.update({ where: { id: before.id }, data: { ...rest, ...(specifications ? { specifications: specifications as Prisma.InputJsonValue } : {}) } });
    const totalBefore = r.estimated_total_minor;
    const { estimated_total_minor: totalAfter } = await recomputeRequisitionTotals(tx, r.id);

    let reapproval = "NO_CHANGE";
    if (r.status === "APPROVED") {
      const settings = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
      reapproval = await maybeTriggerReapproval(tx, r.id, settings.reapproval_policy, totalBefore, totalAfter);
    }
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "requisition_concept.updated", resourceType: "requisition_concept", resourceId: after.id, resourceLabel: after.name, changes: changes as Prisma.InputJsonValue, metadata: { reapproval } });
    return after;
  });
  return NextResponse.json(updated);
});

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await checkEditable(tx, params.id, actor);
    const concept = await tx.requisition_concepts.findFirst({ where: { id: params.cid, requisition_id: r.id } });
    if (!concept) throw Problem.notFound();
    const remaining = await tx.requisition_concepts.count({ where: { requisition_id: r.id } });
    if (remaining <= 1) throw Problem.conflict("Una requisición debe tener al menos un concepto");

    await tx.requisition_concepts.delete({ where: { id: concept.id } });
    const totalBefore = r.estimated_total_minor;
    const { estimated_total_minor: totalAfter } = await recomputeRequisitionTotals(tx, r.id);

    let reapproval = "NO_CHANGE";
    if (r.status === "APPROVED") {
      const settings = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
      reapproval = await maybeTriggerReapproval(tx, r.id, settings.reapproval_policy, totalBefore, totalAfter);
    }
    await audit(tx, { ...auditBase(actor), action: "requisition_concept.deleted", resourceType: "requisition_concept", resourceId: concept.id, resourceLabel: concept.name, metadata: { reapproval } });
  });
  return new Response(null, { status: 204 });
});
