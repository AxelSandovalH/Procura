import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor, type Actor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";
import { maybeTriggerReapproval } from "@/lib/requisitions/approval-engine";
import type { Prisma, requisitions } from "@prisma/client";
import { isoDateNullableOptional } from "@/lib/validation";

const MATERIAL_FIELDS = ["budget_max_minor"] as const;

export function availableActions(r: requisitions, actor: Actor): string[] {
  const actions: string[] = [];
  const isOwner = r.requester_membership_id === actor.membershipId;
  const p = actor.permissions;
  if (r.status === "DRAFT") {
    if ((isOwner && p.has("requisition.update")) || p.has("requisition.update_any")) actions.push("update");
    if ((isOwner && p.has("requisition.submit")) || p.has("requisition.update_any")) actions.push("submit");
    if ((isOwner && p.has("requisition.cancel")) || p.has("requisition.cancel")) actions.push("cancel");
  }
  if (r.status === "PENDING_APPROVAL") {
    if (isOwner || p.has("requisition.update_any")) actions.push("withdraw");
    if (p.has("requisition.cancel")) actions.push("cancel");
  }
  if (r.status === "APPROVED") {
    if (p.has("requisition.update_any")) actions.push("update");
    if (p.has("requisition.cancel")) actions.push("cancel");
  }
  if (r.status === "RESOLVED" && p.has("requisition.close")) actions.push("close");
  if (r.status !== "CANCELLED" && r.status !== "REJECTED" && p.has("requisition.create")) actions.push("duplicate");
  return actions;
}

async function loadRequisition(tx: Tx, id: string, actor: Actor) {
  const r = await tx.requisitions.findFirst({
    where: actor.permissions.has("requisition.read_all") ? { id } : { id, OR: [{ requester_membership_id: actor.membershipId ?? "__none__" }, { organization_id: actor.organizationId }] },
    include: { requisition_concepts: { orderBy: { line_number: "asc" } } },
  });
  if (!r) throw Problem.notFound();
  return r;
}

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.read");
  const r = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => loadRequisition(tx, params.id, actor));
  const { budget_max_minor, estimated_total_minor, requisition_concepts, ...rest } = r;
  const canSeePrivate = actor.permissions.has("requisition.read_private");
  return NextResponse.json({
    ...rest,
    budget_max_minor: canSeePrivate ? budget_max_minor : undefined,
    estimated_total_minor: canSeePrivate ? estimated_total_minor : undefined,
    concepts: requisition_concepts.map(({ estimated_unit_price_minor, budget_minor, ...c }) => ({
      ...c, estimated_unit_price_minor: canSeePrivate ? estimated_unit_price_minor : undefined, budget_minor: canSeePrivate ? budget_minor : undefined,
    })),
    available_actions: availableActions(r, actor),
  });
});

const Update = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  required_date: isoDateNullableOptional,
  department_id: z.uuid().nullable().optional(),
  location_id: z.uuid().nullable().optional(),
  suggested_supplier_organization_id: z.uuid().nullable().optional(),
  budget_max_minor: z.number().int().min(0).nullable().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await loadRequisition(tx, params.id, actor);
    const isOwner = before.requester_membership_id === actor.membershipId;
    const canEditOwn = isOwner && actor.permissions.has("requisition.update") && before.status === "DRAFT";
    const canEditAny = actor.permissions.has("requisition.update_any");
    if (!canEditOwn && !canEditAny) throw Problem.forbidden("No tienes permiso para editar esta requisición");
    if (before.status !== "DRAFT" && before.status !== "APPROVED") throw Problem.conflict(`No se puede editar en estado ${before.status}`);

    const totalBefore = before.estimated_total_minor;
    const after = await tx.requisitions.update({ where: { id: before.id }, data: body });

    let reapproval: string = "NO_CHANGE";
    if (before.status === "APPROVED") {
      const materialHeaderChange = MATERIAL_FIELDS.some((f) => body[f] !== undefined && body[f] !== before[f]);
      if (materialHeaderChange) {
        const settings = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
        reapproval = await maybeTriggerReapproval(tx, before.id, settings.reapproval_policy, totalBefore, totalBefore);
      }
    }

    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "requisition.updated", resourceType: "requisition", resourceId: after.id, resourceLabel: after.folio, changes: changes as Prisma.InputJsonValue, metadata: { reapproval } });
    return tx.requisitions.findUniqueOrThrow({ where: { id: before.id } });
  });
  return NextResponse.json(updated);
});
