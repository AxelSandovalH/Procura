import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().max(500).optional() });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "member.manage");
  const { reason } = await json(req, (d) => Body.parse(d ?? {}));

  const membership = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, include: { users: { select: { email: true } } } });
    if (!target) throw Problem.notFound();
    if (target.is_primary_admin) throw Problem.forbidden("El administrador principal no puede ser suspendido");
    if (target.status !== "ACTIVE") throw Problem.conflict(`La membresía está en estado ${target.status}, no ACTIVE`);
    const updated = await tx.memberships.update({ where: { id: target.id }, data: { status: "SUSPENDED", suspended_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "membership.suspended", resourceType: "membership", resourceId: updated.id, resourceLabel: target.users.email, reason });
    return updated;
  });
  return NextResponse.json(membership);
});
