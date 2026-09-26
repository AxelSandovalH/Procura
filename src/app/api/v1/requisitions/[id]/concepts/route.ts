import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";
import { maybeTriggerReapproval } from "@/lib/requisitions/approval-engine";
import type { Prisma } from "@prisma/client";

const Create = z.object({
  concept_type: z.enum(["GOOD", "SERVICE"]),
  source: z.enum(["CATALOG", "SUPPLIER_CATALOG", "FREE"]),
  catalog_item_id: z.uuid().optional(),
  supplier_catalog_item_id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  specifications: z.record(z.string(), z.unknown()).default({}),
  quantity: z.number().positive(),
  unit_id: z.uuid().optional(),
  unit_label: z.string().trim().min(1).max(40),
  estimated_unit_price_minor: z.number().int().min(0).optional(),
  budget_minor: z.number().int().min(0).optional(),
  required_date: z.iso.date().optional(),
  location_id: z.uuid().optional(),
});

/** Solo en requisiciones editables (DRAFT propia, o APPROVED para Compras — con reapproval). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Create.parse(d));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    const isOwner = r.requester_membership_id === actor.membershipId;
    const canEditOwn = isOwner && actor.permissions.has("requisition.update") && r.status === "DRAFT";
    const canEditAny = actor.permissions.has("requisition.update_any");
    if (!canEditOwn && !canEditAny) throw Problem.forbidden("No tienes permiso para editar esta requisición");
    if (r.status !== "DRAFT" && r.status !== "APPROVED") throw Problem.conflict(`No se puede editar en estado ${r.status}`);

    const settings = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
    if (!settings.allow_free_concepts && body.source === "FREE") throw Problem.badRequest("Esta organización no permite conceptos libres");

    const maxLine = await tx.requisition_concepts.aggregate({ where: { requisition_id: r.id }, _max: { line_number: true } });
    const concept = await tx.requisition_concepts.create({
      data: { organization_id: actor.organizationId, requisition_id: r.id, line_number: (maxLine._max.line_number ?? 0) + 1, ...body, specifications: body.specifications as Prisma.InputJsonValue },
    });
    const totalBefore = r.estimated_total_minor;
    const { estimated_total_minor: totalAfter } = await recomputeRequisitionTotals(tx, r.id);

    let reapproval = "NO_CHANGE";
    if (r.status === "APPROVED") reapproval = await maybeTriggerReapproval(tx, r.id, settings.reapproval_policy, totalBefore, totalAfter);

    await audit(tx, { ...auditBase(actor), action: "requisition_concept.created", resourceType: "requisition_concept", resourceId: concept.id, resourceLabel: concept.name, metadata: { reapproval } });
    return { concept, reapproval };
  });
  return NextResponse.json(result.concept, { status: 201 });
});
