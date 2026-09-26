import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

/** El proveedor que la abre por primera vez la marca VIEWED (WORKFLOWS.md §3). requisition_id solo perspectiva BUYER. */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const rfq = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.quotation_requests.findFirst({
      where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] },
      include: {
        quotation_request_lines: { orderBy: { line_number: "asc" } },
        organizations_quotation_requests_buyer_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
        organizations_quotation_requests_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
      },
    });
    if (!r) throw Problem.notFound();
    const isSupplier = r.supplier_organization_id === actor.organizationId;
    if (isSupplier && r.status === "SENT") {
      const viewedAt = new Date();
      await tx.quotation_requests.update({ where: { id: r.id }, data: { status: "VIEWED", viewed_at: viewedAt } });
      await audit(tx, { actorType: actor.type, actorId: actor.userId ?? actor.apiKeyId, membershipId: actor.membershipId, organizationId: actor.organizationId, visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "rfq.viewed", resourceType: "quotation_request", resourceId: r.id, resourceLabel: r.rfq_number });
      await emitEvent(tx, { type: "rfq.viewed", aggregateType: "quotation_request", aggregateId: r.id, actor, recipients: [{ organizationId: r.buyer_organization_id, perspective: "BUYER", payload: { rfq: { id: r.id, rfq_number: r.rfq_number } } }] });
      await notifyPermissionHolders(tx, { organizationId: r.buyer_organization_id, permission: "rfq.issue", type: "rfq.viewed", title: `${r.rfq_number} fue vista por el proveedor`, resourceType: "quotation_request", resourceId: r.id });
      r.status = "VIEWED";
      r.viewed_at = viewedAt;
    }
    return r;
  });
  const isBuyer = rfq.buyer_organization_id === actor.organizationId;
  return NextResponse.json({
    id: rfq.id, rfq_number: rfq.rfq_number, status: rfq.status, due_date: rfq.due_date, required_date: rfq.required_date, message: rfq.message,
    perspective: isBuyer ? "BUYER" : "SUPPLIER",
    requisition_id: isBuyer ? rfq.requisition_id : undefined,
    buyer: rfq.organizations_quotation_requests_buyer_organization_idToorganizations,
    supplier: rfq.organizations_quotation_requests_supplier_organization_idToorganizations,
    lines: rfq.quotation_request_lines,
    created_at: rfq.created_at, viewed_at: rfq.viewed_at, declined_at: rfq.declined_at, withdrawn_at: rfq.withdrawn_at,
  });
});
