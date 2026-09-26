import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";
import { isoDateOptional } from "@/lib/validation";

const Create = z.object({
  supplier_organization_ids: z.array(z.uuid()).min(1),
  due_date: isoDateOptional,
  message: z.string().trim().max(2000).optional(),
  concept_ids: z.array(z.uuid()).optional(),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "rfq.issue");
  const rfqs = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } });
    if (!r) throw Problem.notFound();
    return tx.quotation_requests.findMany({
      where: { requisition_id: r.id }, orderBy: { created_at: "desc" },
      include: { organizations_quotation_requests_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } } },
    });
  });
  return NextResponse.json({ data: rfqs });
});

/**
 * Emite una RFQ por proveedor: proyecta SOLO los campos compartidos de cada concepto
 * (nunca budget_minor ni estimated_unit_price_minor — esos quedan en requisition_concepts).
 */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "rfq.issue");
  const body = await json(req, (d) => Create.parse(d));

  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { requisition_concepts: true } });
    if (!r) throw Problem.notFound();
    if (r.status !== "APPROVED" && r.status !== "SENT") throw Problem.conflict(`No se puede emitir RFQ en estado ${r.status}`);

    const concepts = body.concept_ids ? r.requisition_concepts.filter((c) => body.concept_ids!.includes(c.id)) : r.requisition_concepts;
    if (concepts.length === 0) throw Problem.badRequest("No hay conceptos para incluir en la RFQ");

    const rfqs = [];
    for (const supplierOrgId of body.supplier_organization_ids) {
      const relationship = await tx.relationships.findFirst({ where: { buyer_organization_id: actor.organizationId, supplier_organization_id: supplierOrgId, status: "ACTIVE" } });
      if (!relationship) throw Problem.badRequest(`No hay una relación ACTIVE con la organización ${supplierOrgId}`);

      const rfq = await tx.quotation_requests.create({
        data: {
          requisition_id: r.id, relationship_id: relationship.id, buyer_organization_id: actor.organizationId, supplier_organization_id: supplierOrgId,
          due_date: body.due_date, message: body.message, required_date: r.required_date, issued_by_membership_id: actor.membershipId,
          delivery_locations: concepts.map((c) => ({ concept_id: c.id, location_id: c.location_id })).filter((d) => d.location_id) as Prisma.InputJsonValue,
        },
      });
      await tx.quotation_request_lines.createMany({
        data: concepts.map((c, i) => ({
          rfq_id: rfq.id, buyer_organization_id: actor.organizationId, supplier_organization_id: supplierOrgId, requisition_concept_id: c.id,
          line_number: i + 1, name: c.name, description: c.description, specifications: c.specifications ?? {}, quantity: c.quantity, unit_label: c.unit_label,
          required_date: c.required_date, delivery_location: c.location_id ? ({ location_id: c.location_id } as Prisma.InputJsonValue) : undefined,
          supplier_catalog_item_id: c.source === "SUPPLIER_CATALOG" ? c.supplier_catalog_item_id : null,
        })),
      });
      await audit(tx, { ...auditBase(actor), visibleTo: [actor.organizationId, supplierOrgId], action: "rfq.issued", resourceType: "quotation_request", resourceId: rfq.id, resourceLabel: rfq.rfq_number });
      rfqs.push(rfq);
    }

    if (r.status === "APPROVED") await tx.requisitions.update({ where: { id: r.id }, data: { status: "SENT", sent_at: new Date() } });
    return rfqs;
  });
  return NextResponse.json({ data: created }, { status: 201 });
});
