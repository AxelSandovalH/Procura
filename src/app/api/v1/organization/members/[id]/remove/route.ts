import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notify } from "@/lib/events/emit";

const Body = z.object({ reason: z.string().trim().max(500).optional() });

/** Remueve una membresía (nunca se borra la fila) y desactiva sus asignaciones de rol. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "member.manage");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));

  const membership = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { users: { select: { email: true } } } });
    if (!target) throw Problem.notFound();
    if (target.is_primary_admin) throw Problem.forbidden("El administrador principal no puede ser removido; transfiere el rol primero");
    if (target.status === "REMOVED") throw Problem.conflict("La membresía ya está removida");
    const updated = await tx.memberships.update({ where: { id: target.id }, data: { status: "REMOVED", removed_at: new Date() } });
    await tx.role_assignments.updateMany({ where: { membership_id: target.id, revoked_at: null }, data: { revoked_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "membership.removed", resourceType: "membership", resourceId: updated.id, resourceLabel: target.users.email, reason });
    await emitEvent(tx, { type: "membership.removed", aggregateType: "membership", aggregateId: updated.id, actor, recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { membership: { id: updated.id, status: updated.status } } }] });
    await notify(tx, { organizationId: actor.organizationId, membershipIds: [target.id], type: "membership.removed", title: "Tu membresía fue removida", resourceType: "membership", resourceId: updated.id });
    return updated;
  });
  return NextResponse.json(membership);
});
