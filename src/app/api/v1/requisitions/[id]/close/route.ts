import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.close");
  const requisition = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!r) throw Problem.notFound();
    if (r.status !== "RESOLVED") throw Problem.conflict(`No se puede cerrar en estado ${r.status}`);
    const updated = await tx.requisitions.update({ where: { id: r.id }, data: { status: "CLOSED", closed_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "requisition.closed", resourceType: "requisition", resourceId: r.id, resourceLabel: r.folio });
    return updated;
  });
  return NextResponse.json(requisition);
});
