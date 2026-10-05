import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { acceptQuotationAndCreateOrder } from "@/lib/sourcing/create-order";
import { announceOrderCreated } from "@/lib/sourcing/order-events";
import { startApprovalRequest } from "@/lib/requisitions/approval-engine";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.accept")) throw Problem.forbidden();
    // OD-14: NOT_SELECTED no es terminal — puede reabrirse si sigue vigente.
    if (q.status !== "SUBMITTED" && q.status !== "NOT_SELECTED") throw Problem.conflict(`No se puede aceptar en estado ${q.status}`);
    if (q.valid_until && q.valid_until < new Date(new Date().toDateString())) throw Problem.conflict("La cotización ya expiró");

    const rfq = await tx.quotation_requests.findUniqueOrThrow({ where: { id: q.rfq_id }, select: { requisition_id: true } });
    const existingLiveOrder = await tx.orders.findFirst({ where: { requisition_id: rfq.requisition_id, status: { notIn: ["REJECTED", "CANCELLED"] } } });
    if (existingLiveOrder) throw Problem.conflict("Esta requisición ya tiene una orden viva");

    const requisition = await tx.requisitions.findUniqueOrThrow({ where: { id: rfq.requisition_id } });
    if (requisition.status === "PENDING_APPROVAL") throw Problem.conflict("Esta requisición ya tiene una compra esperando aprobación");

    // Aprobar después de cotizar: la compra elegida es la que se aprueba (y su monto el que evalúan las reglas).
    const settings = await tx.organization_settings.findUnique({ where: { organization_id: actor.organizationId }, select: { approval_timing: true } });
    const alreadyApproved = await tx.approval_requests.findFirst({ where: { quotation_id: q.id, status: "APPROVED" }, select: { id: true } });
    const needsApproval = settings?.approval_timing === "AFTER_QUOTING" && !requisition.approved_at && !alreadyApproved;

    if (needsApproval) {
      const start = await startApprovalRequest(tx, requisition, { quotationId: q.id, amountMinor: q.total_minor });
      if (start.status === "PENDING_APPROVAL") {
        await tx.requisitions.update({ where: { id: requisition.id }, data: { status: "PENDING_APPROVAL" } });
        await audit(tx, { ...auditBase(actor), action: "requisition.approval_requested", resourceType: "requisition", resourceId: requisition.id, resourceLabel: requisition.folio, metadata: { quotation_id: q.id, quotation_number: q.quotation_number, total_minor: q.total_minor.toString() } });
        await emitEvent(tx, { type: "requisition.approval_requested", aggregateType: "requisition", aggregateId: requisition.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { requisition: { id: requisition.id, folio: requisition.folio, status: "PENDING_APPROVAL", quotation_id: q.id } } }] });
        await notifyPermissionHolders(tx, { organizationId: actor.organizationId, permission: "requisition.approve", excludeMembershipId: actor.membershipId ?? undefined, type: "requisition.approval_requested", title: `${requisition.folio}: compra ${q.quotation_number} espera tu aprobación`, resourceType: "requisition", resourceId: requisition.id });
        return { approval_required: true as const, quotation: q, order: null };
      }
      // Sin reglas aplicables: se aprueba sola y sigue directo a la orden.
      await tx.requisitions.update({ where: { id: requisition.id }, data: { approved_at: new Date(), approved_version: requisition.version } });
      await audit(tx, { ...auditBase(actor), action: "requisition.approved", resourceType: "requisition", resourceId: requisition.id, resourceLabel: requisition.folio, metadata: { auto: true, quotation_id: q.id } });
    }

    const order = await acceptQuotationAndCreateOrder(tx, q.id, actor.membershipId);
    await announceOrderCreated(tx, actor, q.id, order.id);
    return { approval_required: false as const, quotation: await tx.quotations.findUniqueOrThrow({ where: { id: q.id } }), order };
  });
  return NextResponse.json(result);
});
