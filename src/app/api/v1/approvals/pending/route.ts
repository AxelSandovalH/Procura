import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

/** Requisiciones cuyo nivel actual de aprobación tiene al actor como aprobador resuelto. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  if (!actor.membershipId) return NextResponse.json({ data: [] });

  const requests = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.approval_requests.findMany({
      where: {
        organization_id: actor.organizationId, status: "PENDING",
        approval_steps: { some: { status: "PENDING", resolved_approver_membership_ids: { has: actor.membershipId! } } },
      },
      include: { requisitions: true, approval_steps: { where: { status: "PENDING" }, take: 1 } },
    }),
  );
  return NextResponse.json({
    data: requests
      .filter((r) => r.current_level != null && r.approval_steps[0]?.level === r.current_level)
      .map((r) => ({ requisition: r.requisitions, approval_request_id: r.id, level: r.current_level })),
  });
});
