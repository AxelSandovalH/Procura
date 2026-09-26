import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notify } from "@/lib/events/emit";

const Body = z.object({ reason: z.string().trim().max(500).optional() });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "member.approve");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));

  const membership = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { users: { select: { email: true } } } });
    if (!target) throw Problem.notFound();
    if (target.status !== "PENDING") throw Problem.conflict(`La membresía está en estado ${target.status}, no PENDING`);
    const updated = await tx.memberships.update({ where: { id: target.id }, data: { status: "REMOVED", removed_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "membership.rejected", resourceType: "membership", resourceId: updated.id, resourceLabel: target.users.email, reason });
    await emitEvent(tx, { type: "membership.rejected", aggregateType: "membership", aggregateId: updated.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { membership: { id: updated.id, status: updated.status } } }] });
    await notify(tx, { organizationId: actor.organizationId, membershipIds: [target.id], type: "membership.rejected", title: "Tu solicitud de membresía fue rechazada", resourceType: "membership", resourceId: updated.id });
    return updated;
  });
  return NextResponse.json(membership);
});
