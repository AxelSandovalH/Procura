import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notify } from "@/lib/events/emit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "member.manage");

  const membership = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { users: { select: { email: true } } } });
    if (!target) throw Problem.notFound();
    if (target.status !== "SUSPENDED") throw Problem.conflict(`La membresía está en estado ${target.status}, no SUSPENDED`);
    const updated = await tx.memberships.update({ where: { id: target.id }, data: { status: "ACTIVE", suspended_at: null } });
    await audit(tx, { ...auditBase(actor), action: "membership.reactivated", resourceType: "membership", resourceId: updated.id, resourceLabel: target.users.email });
    await emitEvent(tx, { type: "membership.reactivated", aggregateType: "membership", aggregateId: updated.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { membership: { id: updated.id, status: updated.status } } }] });
    await notify(tx, { organizationId: actor.organizationId, membershipIds: [target.id], type: "membership.reactivated", title: "Tu membresía fue reactivada", resourceType: "membership", resourceId: updated.id });
    return updated;
  });
  return NextResponse.json(membership);
});
