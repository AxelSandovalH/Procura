import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Update = z.object({ name: z.string().trim().min(1).max(120).optional(), parent_id: z.uuid().nullable().optional(), is_active: z.boolean().optional() });

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.categories.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    if (body.parent_id === params.id) throw Problem.badRequest("Una categoría no puede ser su propio padre");
    const after = await tx.categories.update({ where: { id: params.id }, data: body });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "category.updated", resourceType: "category", resourceId: after.id, resourceLabel: after.name, changes: changes as Prisma.InputJsonValue });
    return after;
  });
  return NextResponse.json(updated);
});
