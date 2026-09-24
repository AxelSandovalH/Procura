import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().max(40).nullable().optional(),
  parent_id: z.uuid().nullable().optional(),
  head_membership_id: z.uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "department.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.departments.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    if (body.parent_id === params.id) throw Problem.badRequest("Un departamento no puede ser su propio padre");
    if (body.parent_id) {
      const parent = await tx.departments.findFirst({ where: { id: body.parent_id, organization_id: actor.organizationId } });
      if (!parent) throw Problem.badRequest("parent_id no existe en esta organización");
    }
    if (body.head_membership_id) {
      const head = await tx.memberships.findFirst({ where: { id: body.head_membership_id, organization_id: actor.organizationId, status: "ACTIVE" } });
      if (!head) throw Problem.badRequest("head_membership_id no es un miembro activo de esta organización");
    }
    const after = await tx.departments.update({ where: { id: params.id }, data: body });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) {
      await audit(tx, { ...auditBase(actor), action: "department.updated", resourceType: "department", resourceId: after.id, resourceLabel: after.name, changes: changes as Prisma.InputJsonValue });
    }
    return after;
  });
  return NextResponse.json(updated);
});
