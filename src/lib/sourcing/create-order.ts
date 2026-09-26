import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

/**
 * Aceptar una cotización crea la orden automáticamente (regla 7). OD-03: solo se acepta una
 * cotización COMPLETA (sin líneas DECLINED que dejen conceptos de la requisición sin cubrir);
 * si el proveedor declinó algo, hay que resolverlo (línea ADDITIONAL como sustituto, o dividir la
 * requisición — `split` queda fuera de este bloque, ver OPEN_DECISIONS OD-03/OD-33).
 */
export async function acceptQuotationAndCreateOrder(tx: Tx, quotationId: string, actorMembershipId: string | null) {
  const quotation = await tx.quotations.findUniqueOrThrow({ where: { id: quotationId }, include: { quotation_lines: true } });
  if (quotation.quotation_lines.some((l) => l.line_kind === "DECLINED")) {
    throw Problem.conflict("La cotización declina uno o más conceptos; no se puede aceptar parcialmente (OD-03). Pide al proveedor una cotización completa.");
  }
  const acceptableLines = quotation.quotation_lines.filter((l) => l.line_kind !== "DECLINED");
  if (acceptableLines.length === 0) throw Problem.badRequest("La cotización no tiene líneas para ordenar");

  const requisition = await tx.quotation_requests.findUniqueOrThrow({ where: { id: quotation.rfq_id }, select: { requisition_id: true, required_date: true } });
  const relationship = await tx.relationships.findUniqueOrThrow({ where: { id: quotation.relationship_id } });
  if (relationship.status !== "ACTIVE") throw Problem.conflict("La relación no está ACTIVE");

  const order = await tx.orders.create({
    data: {
      requisition_id: requisition.requisition_id, quotation_id: quotation.id, relationship_id: quotation.relationship_id,
      buyer_organization_id: quotation.buyer_organization_id, supplier_organization_id: quotation.supplier_organization_id,
      currency: quotation.currency, subtotal_minor: quotation.subtotal_minor, tax_minor: quotation.tax_minor, total_minor: quotation.total_minor,
      payment_terms: quotation.payment_terms, delivery_terms: quotation.delivery_terms, required_date: requisition.required_date,
    },
  });

  const rfqLineToConceptId = new Map(
    (await tx.quotation_request_lines.findMany({ where: { rfq_id: quotation.rfq_id }, select: { id: true, requisition_concept_id: true, delivery_location: true } }))
      .map((l) => [l.id, l]),
  );
  await tx.order_lines.createMany({
    data: acceptableLines.map((l, i) => {
      const src = l.rfq_line_id ? rfqLineToConceptId.get(l.rfq_line_id) : undefined;
      return {
        order_id: order.id, buyer_organization_id: quotation.buyer_organization_id, supplier_organization_id: quotation.supplier_organization_id,
        line_number: i + 1, quotation_line_id: l.id, requisition_concept_id: src?.requisition_concept_id,
        name: l.name, description: l.description, quantity: l.quantity, unit_label: l.unit_label,
        unit_price_minor: l.unit_price_minor, line_total_minor: l.line_total_minor, delivery_location: src?.delivery_location ?? undefined,
      };
    }),
  });

  await tx.quotations.update({ where: { id: quotation.id }, data: { status: "ACCEPTED", accepted_at: new Date(), accepted_by_membership_id: actorMembershipId } });

  // Otras cotizaciones vigentes de otras RFQ de la misma requisición → NOT_SELECTED; sus RFQ sin decidir → CLOSED.
  const otherRfqs = await tx.quotation_requests.findMany({ where: { requisition_id: requisition.requisition_id, id: { not: quotation.rfq_id } } });
  for (const rfq of otherRfqs) {
    await tx.quotations.updateMany({ where: { rfq_id: rfq.id, status: { in: ["SUBMITTED", "NOT_SELECTED"] } }, data: { status: "NOT_SELECTED" } });
    if (["SENT", "VIEWED", "QUOTED"].includes(rfq.status)) await tx.quotation_requests.update({ where: { id: rfq.id }, data: { status: "CLOSED", closed_at: new Date() } });
  }

  await tx.requisitions.update({ where: { id: requisition.requisition_id }, data: { status: "IN_PROCESS", order_id: order.id } });
  return order;
}
