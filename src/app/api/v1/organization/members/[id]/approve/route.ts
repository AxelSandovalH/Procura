import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notify } from "@/lib/events/emit";

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "member.approve");

  const membership = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { users: { select: { email: true } } } });
    if (!target) throw Problem.notFound();
    if (target.status !== "PENDING") throw Problem.conflict(`La membresía está en estado ${target.status}, no PENDING`);
    const updated = await tx.memberships.update({
      where: { id: target.id },
      data: { status: "ACTIVE", activated_at: new Date(), approved_by_membership_id: actor.membershipId },
    });
    await audit(tx, { ...auditBase(actor), action: "membership.approved", resourceType: "membership", resourceId: updated.id, resourceLabel: target.users.email });
    await emitEvent(tx, { type: "membership.approved", aggregateType: "membership", aggregateId: updated.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { membership: { id: updated.id, status: updated.status } } }] });
    await notify(tx, { organizationId: actor.organizationId, membershipIds: [target.id], type: "membership.approved", title: "Tu membresía fue aprobada", resourceType: "membership", resourceId: updated.id });
    return updated;
  });
  return NextResponse.json(membership);
});
