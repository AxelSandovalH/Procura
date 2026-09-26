import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { nextFolio } from "@/lib/requisitions/folio";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";

/** Copia libre como nueva DRAFT; la original queda intacta. Sin vínculo vinculante con proveedor. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.create");

  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const original = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { requisition_concepts: true } });
    if (!original) throw Problem.notFound();

    const folio = await nextFolio(tx, actor.organizationId);
    const copy = await tx.requisitions.create({
      data: {
        organization_id: actor.organizationId, folio, title: `${original.title} (copia)`, description: original.description,
        priority: original.priority, required_date: original.required_date, department_id: original.department_id, location_id: original.location_id,
        requester_membership_id: actor.membershipId, origin_type: "DUPLICATE", derived_from_requisition_id: original.id,
        suggested_supplier_organization_id: original.suggested_supplier_organization_id,
        destination_contact: original.destination_contact, delivery_location_id: original.delivery_location_id,
        budget_max_minor: original.budget_max_minor, currency: original.currency,
      },
    });
    await tx.requisition_concepts.createMany({
      data: original.requisition_concepts.map((c) => ({
        organization_id: actor.organizationId, requisition_id: copy.id, line_number: c.line_number, concept_type: c.concept_type, source: c.source,
        catalog_item_id: c.catalog_item_id, supplier_catalog_item_id: c.supplier_catalog_item_id, name: c.name, description: c.description,
        specifications: c.specifications ?? {}, quantity: c.quantity, unit_id: c.unit_id, unit_label: c.unit_label,
        estimated_unit_price_minor: c.estimated_unit_price_minor, budget_minor: c.budget_minor, required_date: c.required_date, location_id: c.location_id,
      })),
    });
    await recomputeRequisitionTotals(tx, copy.id);
    await audit(tx, { ...auditBase(actor), action: "requisition.duplicated", resourceType: "requisition", resourceId: copy.id, resourceLabel: copy.folio, metadata: { from: original.folio } });
    return copy;
  });
  return NextResponse.json(created, { status: 201 });
});
