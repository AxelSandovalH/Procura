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
  address: z.record(z.string(), z.unknown()).optional(),
  contact_name: z.string().trim().max(120).nullable().optional(),
  contact_phone: z.string().trim().max(40).nullable().optional(),
  is_delivery_point: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "location.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.locations.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    const { address, ...rest } = body;
    const after = await tx.locations.update({ where: { id: params.id }, data: { ...rest, ...(address !== undefined ? { address: address as Prisma.InputJsonValue } : {}) } });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) {
      await audit(tx, { ...auditBase(actor), action: "location.updated", resourceType: "location", resourceId: after.id, resourceLabel: after.name, changes: changes as Prisma.InputJsonValue });
    }
    return after;
  });
  return NextResponse.json(updated);
});
