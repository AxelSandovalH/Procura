import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.read");
  const requests = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } });
    if (!r) throw Problem.notFound();
    return tx.approval_requests.findMany({
      where: { requisition_id: r.id },
      orderBy: { started_at: "asc" },
      include: { approval_steps: { orderBy: { level: "asc" }, include: { approval_decisions: true } } },
    });
  });
  return NextResponse.json({ data: requests });
});
