import type { requisitions } from "@prisma/client";
import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notify, notifyPermissionHolders } from "@/lib/events/emit";
import { startApprovalRequest } from "@/lib/requisitions/approval-engine";
import { autoIssueDirectedRfq } from "@/lib/sourcing/issue-rfq";

/**
 * Envía una requisición (DRAFT → …) según cuándo aprueba la organización (`approval_timing`):
 *  - BEFORE_QUOTING: arranca la aprobación de la requisición (o la aprueba sola si no hay reglas); aprobada, Compras cotiza.
 *  - AFTER_QUOTING: queda SUBMITTED («por cotizar»), sin aprobación: Compras cotiza y la aprobación se pide sobre la compra elegida.
 * Un único lugar para ambas rutas (crear con `submit` y `POST /requisitions/{id}/submit`).
 */
export async function submitRequisition(tx: Tx, actor: Actor, r: requisitions): Promise<requisitions> {
  const settings = await tx.organization_settings.findUnique({ where: { organization_id: r.organization_id }, select: { approval_timing: true } });
  const timing = settings?.approval_timing ?? "BEFORE_QUOTING";
  const org = actor.organizationId;

  if (timing === "AFTER_QUOTING") {
    const updated = await tx.requisitions.update({ where: { id: r.id }, data: { status: "SUBMITTED", submitted_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "requisition.submitted", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio });
    await emitEvent(tx, { type: "requisition.submitted", aggregateType: "requisition", aggregateId: r.id, actor, recipients: [{ organizationId: org, perspective: "OWNER", payload: { requisition: { id: r.id, folio: r.folio, status: updated.status } } }] });
    await notifyPermissionHolders(tx, { organizationId: org, permission: "rfq.issue", excludeMembershipId: actor.membershipId ?? undefined, type: "requisition.submitted", title: `${r.folio} está lista para cotizar`, resourceType: "requisition", resourceId: r.id });
    if ((await autoIssueDirectedRfq(tx, actor, r.id)) === "ISSUED") return tx.requisitions.findUniqueOrThrow({ where: { id: r.id } });
    return updated;
  }

  const outcome = await startApprovalRequest(tx, r);
  const updated = await tx.requisitions.update({
    where: { id: r.id },
    data: outcome.status === "APPROVED"
      ? { status: "APPROVED", submitted_at: new Date(), approved_at: new Date(), approved_version: r.version }
      : { status: "PENDING_APPROVAL", submitted_at: new Date() },
  });
  await audit(tx, { ...auditBase(actor), action: "requisition.submitted", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio });
  await emitEvent(tx, { type: "requisition.submitted", aggregateType: "requisition", aggregateId: r.id, actor, recipients: [{ organizationId: org, perspective: "OWNER", payload: { requisition: { id: r.id, folio: r.folio, status: updated.status } } }] });

  if (outcome.status === "APPROVED") {
    await audit(tx, { ...auditBase(actor), action: "requisition.approved", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio, metadata: { auto: true } });
    await emitEvent(tx, { type: "requisition.approved", aggregateType: "requisition", aggregateId: r.id, actor, recipients: [{ organizationId: org, perspective: "OWNER", payload: { requisition: { id: r.id, folio: r.folio } } }] });
    if (r.requester_membership_id) await notify(tx, { organizationId: org, membershipIds: [r.requester_membership_id], type: "requisition.approved", title: `${r.folio} fue aprobada`, resourceType: "requisition", resourceId: r.id });
    if ((await autoIssueDirectedRfq(tx, actor, r.id)) === "ISSUED") return tx.requisitions.findUniqueOrThrow({ where: { id: r.id } });
  } else {
    await notifyPermissionHolders(tx, { organizationId: org, permission: "requisition.approve", excludeMembershipId: actor.membershipId ?? undefined, type: "requisition.submitted", title: `${r.folio} espera tu aprobación`, resourceType: "requisition", resourceId: r.id });
  }
  return updated;
}
