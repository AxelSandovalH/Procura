import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Update = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(500).nullable().optional(), is_active: z.boolean().optional() });

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "template.manage");
  const body = await json(req, (d) => Update.parse(d));
  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.requisition_templates.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    const after = await tx.requisition_templates.update({ where: { id: params.id }, data: body });
    await audit(tx, { ...auditBase(actor), action: "requisition_template.updated", resourceType: "requisition_template", resourceId: after.id, resourceLabel: after.name });
    return after;
  });
  return NextResponse.json(updated);
});
