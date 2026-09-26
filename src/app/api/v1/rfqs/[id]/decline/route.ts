import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));
  const rfq = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.quotation_requests.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    authorize(actor, "rfq.decline", { supplier_organization_id: r.supplier_organization_id, buyer_organization_id: r.buyer_organization_id });
    if (r.status !== "SENT" && r.status !== "VIEWED") throw Problem.conflict(`No se puede declinar en estado ${r.status}`);
    const updated = await tx.quotation_requests.update({ where: { id: r.id }, data: { status: "DECLINED", declined_at: new Date(), declined_reason: reason } });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "rfq.declined", resourceType: "quotation_request", resourceId: r.id, resourceLabel: r.rfq_number, reason });
    return updated;
  });
  return NextResponse.json(rfq);
});
