import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  if (!actor.membershipId) throw Problem.forbidden();
  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.notifications.updateMany({ where: { membership_id: actor.membershipId!, read_at: null }, data: { read_at: new Date() } }),
  );
  return NextResponse.json({ updated: result.count });
});
