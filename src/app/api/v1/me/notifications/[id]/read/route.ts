import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.membershipId) throw Problem.forbidden();
  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const n = await tx.notifications.findFirst({ where: { id: params.id, membership_id: actor.membershipId! } });
    if (!n) throw Problem.notFound();
    if (n.read_at) return n;
    return tx.notifications.update({ where: { id: n.id }, data: { read_at: new Date() } });
  });
  return NextResponse.json(updated);
});
