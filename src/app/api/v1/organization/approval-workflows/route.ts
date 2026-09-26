import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const AppliesTo = z.object({
  requisition_types: z.array(z.enum(["GOODS", "SERVICE", "MIXED"])).optional(),
  department_ids: z.array(z.uuid()).optional(),
  location_ids: z.array(z.uuid()).optional(),
}).default({});

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  is_default: z.boolean().default(false),
  // PER_CONCEPT queda modelado (OD-08) pero no implementado; ver approval-engine.ts.
  mode: z.literal("WHOLE").default("WHOLE"),
  applies_to: AppliesTo,
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "approval_workflow.manage");
  const workflows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.approval_workflows.findMany({ where: { organization_id: actor.organizationId }, orderBy: [{ is_default: "desc" }, { name: "asc" }], include: { approval_rules: { orderBy: { level: "asc" } } } }),
  );
  return NextResponse.json({ data: workflows });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "approval_workflow.manage");
  const body = await json(req, (d) => Create.parse(d));

  const workflow = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    if (body.is_default) {
      await tx.approval_workflows.updateMany({ where: { organization_id: actor.organizationId, is_default: true }, data: { is_default: false } });
    }
    const created = await tx.approval_workflows.create({ data: { organization_id: actor.organizationId, name: body.name, is_default: body.is_default, mode: body.mode, applies_to: body.applies_to as Prisma.InputJsonValue } });
    await audit(tx, { ...auditBase(actor), action: "approval_workflow.created", resourceType: "approval_workflow", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(workflow, { status: 201 });
});
