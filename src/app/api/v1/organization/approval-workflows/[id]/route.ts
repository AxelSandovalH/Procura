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
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  applies_to: z.object({
    requisition_types: z.array(z.enum(["GOODS", "SERVICE", "MIXED"])).optional(),
    department_ids: z.array(z.uuid()).optional(),
    location_ids: z.array(z.uuid()).optional(),
  }).optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "approval_workflow.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.approval_workflows.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    if (body.is_default === true) {
      await tx.approval_workflows.updateMany({ where: { organization_id: actor.organizationId, is_default: true, id: { not: params.id } }, data: { is_default: false } });
    }
    const { applies_to, ...rest } = body;
    const after = await tx.approval_workflows.update({ where: { id: params.id }, data: { ...rest, ...(applies_to ? { applies_to: applies_to as Prisma.InputJsonValue } : {}) } });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "approval_workflow.updated", resourceType: "approval_workflow", resourceId: after.id, resourceLabel: after.name, changes: changes as Prisma.InputJsonValue });
    return after;
  });
  return NextResponse.json(updated);
});
