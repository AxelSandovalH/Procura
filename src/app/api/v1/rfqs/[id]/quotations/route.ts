import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const quotation = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const rfq = await tx.quotation_requests.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!rfq) throw Problem.notFound();
    authorize(actor, "quotation.submit", { supplier_organization_id: rfq.supplier_organization_id, buyer_organization_id: rfq.buyer_organization_id });
    if (!["SENT", "VIEWED", "QUOTED"].includes(rfq.status)) throw Problem.conflict(`No se puede cotizar en estado ${rfq.status}`);

    const relationship = await tx.relationships.findFirstOrThrow({ where: { id: rfq.relationship_id } });
    if (relationship.status !== "ACTIVE") throw Problem.conflict("La relación no está ACTIVE");
    const terms = await tx.relationship_terms.findUnique({ where: { relationship_id: relationship.id } });

    const maxVersion = await tx.quotations.aggregate({ where: { rfq_id: rfq.id }, _max: { version: true } });
    const created = await tx.quotations.create({
      data: {
        rfq_id: rfq.id, relationship_id: relationship.id, buyer_organization_id: rfq.buyer_organization_id, supplier_organization_id: actor.organizationId,
        version: (maxVersion._max.version ?? 0) + 1, status: "DRAFT", currency: terms?.currency ?? "MXN",
      },
    });
    await audit(tx, { ...auditBase(actor), visibleTo: [rfq.buyer_organization_id, rfq.supplier_organization_id], action: "quotation.created", resourceType: "quotation", resourceId: created.id, resourceLabel: created.quotation_number });
    return created;
  });
  return NextResponse.json(quotation, { status: 201 });
});
