import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

/** Crea una nueva versión DRAFT copiando encabezado+líneas; la SUBMITTED anterior se supera al enviar la nueva. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId }, include: { quotation_lines: true } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden();
    if (q.status !== "SUBMITTED") throw Problem.conflict(`Solo se puede revisar una cotización SUBMITTED (actual: ${q.status})`);

    const maxVersion = await tx.quotations.aggregate({ where: { rfq_id: q.rfq_id }, _max: { version: true } });
    const next = await tx.quotations.create({
      data: {
        rfq_id: q.rfq_id, relationship_id: q.relationship_id, buyer_organization_id: q.buyer_organization_id, supplier_organization_id: q.supplier_organization_id,
        version: (maxVersion._max.version ?? q.version) + 1, status: "DRAFT", currency: q.currency, tax_minor: q.tax_minor,
        lead_time_days: q.lead_time_days, delivery_terms: q.delivery_terms, payment_terms: q.payment_terms, notes: q.notes,
      },
    });
    if (q.quotation_lines.length > 0) {
      await tx.quotation_lines.createMany({
        data: q.quotation_lines.map((l) => ({
          quotation_id: next.id, buyer_organization_id: l.buyer_organization_id, supplier_organization_id: l.supplier_organization_id, line_number: l.line_number,
          rfq_line_id: l.rfq_line_id, line_kind: l.line_kind, supplier_catalog_item_id: l.supplier_catalog_item_id, name: l.name, description: l.description,
          specifications: l.specifications ?? {}, quantity: l.quantity, unit_label: l.unit_label, unit_price_minor: l.unit_price_minor, line_total_minor: l.line_total_minor,
          lead_time_days: l.lead_time_days, notes: l.notes,
        })),
      });
    }
    const subtotal = q.quotation_lines.filter((l) => l.line_kind !== "DECLINED").reduce((acc, l) => acc + l.line_total_minor, BigInt(0));
    await tx.quotations.update({ where: { id: next.id }, data: { subtotal_minor: subtotal, total_minor: subtotal + q.tax_minor } });
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation.revised", resourceType: "quotation", resourceId: next.id, resourceLabel: next.quotation_number, metadata: { from: q.quotation_number } });
    return tx.quotations.findUniqueOrThrow({ where: { id: next.id } });
  });
  return NextResponse.json(created, { status: 201 });
});
