import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { nextFolio } from "@/lib/requisitions/folio";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";
import type { Prisma } from "@prisma/client";

interface TemplatePayload {
  title: string; description?: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  department_id?: string; location_id?: string;
  concepts: { concept_type: "GOOD" | "SERVICE"; source: "CATALOG" | "SUPPLIER_CATALOG" | "FREE"; catalog_item_id?: string; name: string; description?: string; quantity: number; unit_label: string; estimated_unit_price_minor?: number }[];
}

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.create");

  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const template = await tx.requisition_templates.findFirst({ where: { id: params.id, organization_id: actor.organizationId, is_active: true } });
    if (!template) throw Problem.notFound();
    const payload = template.payload as unknown as TemplatePayload;

    const folio = await nextFolio(tx, actor.organizationId);
    const requisition = await tx.requisitions.create({
      data: {
        organization_id: actor.organizationId, folio, title: payload.title, description: payload.description, priority: payload.priority,
        department_id: payload.department_id, location_id: payload.location_id, requester_membership_id: actor.membershipId,
        origin_type: "TEMPLATE", template_id: template.id,
      },
    });
    await tx.requisition_concepts.createMany({
      data: payload.concepts.map((c, i) => ({ organization_id: actor.organizationId, requisition_id: requisition.id, line_number: i + 1, ...c, specifications: {} as Prisma.InputJsonValue })),
    });
    await recomputeRequisitionTotals(tx, requisition.id);
    await audit(tx, { ...auditBase(actor), action: "requisition.created", resourceType: "requisition", resourceId: requisition.id, resourceLabel: requisition.folio, metadata: { from_template: template.name } });
    return requisition;
  });
  return NextResponse.json(created, { status: 201 });
});
