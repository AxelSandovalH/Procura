import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import { Problem } from "@/lib/http/problem";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";
import type { Prisma } from "@prisma/client";

export interface IssueOptions { dueDate?: Date; message?: string; conceptIds?: string[]; auto?: boolean }

/**
 * Emite una RFQ por proveedor desde una requisición APPROVED/SENT del actor. Proyecta SOLO los campos
 * compartidos de cada concepto (nunca budget_minor ni estimated_unit_price_minor). La autorización
 * (rfq.issue) la decide el caller: la emisión automática de una requisición dirigida (OD-02) no la
 * dispara una persona con ese permiso sino la aprobación misma.
 */
export async function issueRfqs(tx: Tx, actor: Actor, requisitionId: string, supplierOrgIds: string[], opts: IssueOptions = {}) {
  const r = await tx.requisitions.findFirst({ where: { id: requisitionId, organization_id: actor.organizationId }, include: { requisition_concepts: true } });
  if (!r) throw Problem.notFound();
  if (r.status !== "APPROVED" && r.status !== "SENT") throw Problem.conflict(`No se puede emitir RFQ en estado ${r.status}`);

  const concepts = opts.conceptIds ? r.requisition_concepts.filter((c) => opts.conceptIds!.includes(c.id)) : r.requisition_concepts;
  if (concepts.length === 0) throw Problem.badRequest("No hay conceptos para incluir en la RFQ");

  const rfqs = [];
  for (const supplierOrgId of supplierOrgIds) {
    const relationship = await tx.relationships.findFirst({ where: { buyer_organization_id: actor.organizationId, supplier_organization_id: supplierOrgId, status: "ACTIVE" } });
    if (!relationship) throw Problem.badRequest(`No hay una relación ACTIVE con la organización ${supplierOrgId}`);

    const rfq = await tx.quotation_requests.create({
      data: {
        requisition_id: r.id, relationship_id: relationship.id, buyer_organization_id: actor.organizationId, supplier_organization_id: supplierOrgId,
        due_date: opts.dueDate, message: opts.message, required_date: r.required_date, issued_by_membership_id: actor.membershipId,
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
    await audit(tx, { ...auditBase(actor), visibleTo: [actor.organizationId, supplierOrgId], action: "rfq.issued", resourceType: "quotation_request", resourceId: rfq.id, resourceLabel: rfq.rfq_number, metadata: opts.auto ? { auto: true, reason: "requisición dirigida (portal)" } : undefined });
    await emitEvent(tx, {
      type: "rfq.issued", aggregateType: "quotation_request", aggregateId: rfq.id, actor,
      recipients: [
        { organizationId: actor.organizationId, perspective: "BUYER", payload: { rfq: { id: rfq.id, rfq_number: rfq.rfq_number, requisition_id: r.id } } },
        { organizationId: supplierOrgId, perspective: "SUPPLIER", payload: { rfq: { id: rfq.id, rfq_number: rfq.rfq_number } } },
      ],
    });
    await notifyPermissionHolders(tx, { organizationId: supplierOrgId, permission: "rfq.read", type: "rfq.issued", title: `Nueva RFQ ${rfq.rfq_number}`, resourceType: "quotation_request", resourceId: rfq.id });
    rfqs.push(rfq);
  }

  if (r.status === "APPROVED") await tx.requisitions.update({ where: { id: r.id }, data: { status: "SENT", sent_at: new Date() } });
  return rfqs;
}

/**
 * OD-02: al aprobarse una requisición dirigida (portal) se emite sola la RFQ al proveedor indicado.
 * Nunca bloquea ni revierte la aprobación: si la relación dejó de estar ACTIVE (o ya hay RFQ viva),
 * la requisición queda APPROVED para que Compras decida, y se deja constancia en auditoría.
 */
export async function autoIssueDirectedRfq(tx: Tx, actor: Actor, requisitionId: string): Promise<"ISSUED" | "SKIPPED"> {
  const r = await tx.requisitions.findFirst({ where: { id: requisitionId, organization_id: actor.organizationId }, select: { id: true, folio: true, status: true, directed_supplier_organization_id: true } });
  if (!r || r.status !== "APPROVED" || !r.directed_supplier_organization_id) return "SKIPPED";
  const supplierId = r.directed_supplier_organization_id;

  const [relationship, liveRfq] = await Promise.all([
    tx.relationships.findFirst({ where: { buyer_organization_id: actor.organizationId, supplier_organization_id: supplierId, status: "ACTIVE" }, select: { id: true } }),
    tx.quotation_requests.findFirst({ where: { requisition_id: r.id, supplier_organization_id: supplierId, status: { in: ["SENT", "VIEWED", "QUOTED"] } }, select: { id: true } }),
  ]);
  if (!relationship || liveRfq) {
    await audit(tx, { ...auditBase(actor), action: "rfq.auto_issue_skipped", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, reason: !relationship ? "La relación con el proveedor dirigido ya no está ACTIVE" : "Ya existe una RFQ viva para ese proveedor" });
    return "SKIPPED";
  }
  await issueRfqs(tx, actor, r.id, [supplierId], { auto: true });
  return "ISSUED";
}
