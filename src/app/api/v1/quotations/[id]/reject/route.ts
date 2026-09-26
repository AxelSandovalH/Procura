import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));
  const quotation = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.accept")) throw Problem.forbidden();
    if (q.status !== "SUBMITTED" && q.status !== "NOT_SELECTED") throw Problem.conflict(`No se puede rechazar en estado ${q.status}`);
    const updated = await tx.quotations.update({ where: { id: q.id }, data: { status: "REJECTED", rejected_at: new Date(), rejected_reason: reason } });
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation.rejected", resourceType: "quotation", resourceId: q.id, resourceLabel: q.quotation_number, reason });
    return updated;
  });
  return NextResponse.json(quotation);
});
