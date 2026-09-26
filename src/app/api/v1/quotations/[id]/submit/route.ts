import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const quotation = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId }, include: { quotation_lines: true } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden();
    if (q.status !== "DRAFT") throw Problem.conflict(`No se puede enviar en estado ${q.status}`);
    const substantiveLines = q.quotation_lines.filter((l) => l.line_kind !== "DECLINED");
    if (substantiveLines.length === 0) throw Problem.badRequest("La cotización debe tener al menos una línea que no sea DECLINED");
    if (!q.valid_until) throw Problem.badRequest("Define valid_until antes de enviar");
    if (q.valid_until < new Date(new Date().toDateString())) throw Problem.badRequest("valid_until no puede estar en el pasado");
    if (q.subtotal_minor + q.tax_minor !== q.total_minor) throw Problem.badRequest("subtotal + impuesto no coincide con el total");

    // Si esta es una revisión (misma RFQ, versión anterior SUBMITTED), esa pasa a SUPERSEDED primero.
    await tx.quotations.updateMany({ where: { rfq_id: q.rfq_id, status: "SUBMITTED", id: { not: q.id } }, data: { status: "SUPERSEDED" } });
    const updated = await tx.quotations.update({ where: { id: q.id }, data: { status: "SUBMITTED", submitted_at: new Date(), submitted_by_membership_id: actor.membershipId } });
    await tx.quotation_requests.update({ where: { id: q.rfq_id }, data: { status: "QUOTED" } });
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation.submitted", resourceType: "quotation", resourceId: q.id, resourceLabel: q.quotation_number });
    await emitEvent(tx, {
      type: "quotation.submitted", aggregateType: "quotation", aggregateId: q.id, actor,
      recipients: [
        { organizationId: q.buyer_organization_id, perspective: "BUYER", payload: { quotation: { id: q.id, quotation_number: q.quotation_number, requisition_id: q.rfq_id, total_minor: q.total_minor, currency: q.currency } } },
        { organizationId: q.supplier_organization_id, perspective: "SUPPLIER", payload: { quotation: { id: q.id, quotation_number: q.quotation_number } } },
      ],
    });
    await notifyPermissionHolders(tx, { organizationId: q.buyer_organization_id, permission: "quotation.accept", type: "quotation.submitted", title: `Nueva cotización ${q.quotation_number}`, resourceType: "quotation", resourceId: q.id });
    return updated;
  });
  return NextResponse.json(quotation);
});
