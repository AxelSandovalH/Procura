import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const ConceptPayload = z.object({
  concept_type: z.enum(["GOOD", "SERVICE"]), source: z.enum(["CATALOG", "SUPPLIER_CATALOG", "FREE"]),
  catalog_item_id: z.uuid().optional(), name: z.string().min(1).max(200), description: z.string().max(2000).optional(),
  quantity: z.number().positive(), unit_label: z.string().min(1).max(40), estimated_unit_price_minor: z.number().int().min(0).optional(),
});
const Create = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional(),
  payload: z.object({
    title: z.string().min(1).max(200), description: z.string().max(2000).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    department_id: z.uuid().optional(), location_id: z.uuid().optional(), concepts: z.array(ConceptPayload).min(1),
  }),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const templates = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.requisition_templates.findMany({ where: { organization_id: actor.organizationId, is_active: true }, orderBy: { name: "asc" } }),
  );
  return NextResponse.json({ data: templates });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "template.manage");
  const body = await json(req, (d) => Create.parse(d));
  const template = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const created = await tx.requisition_templates.create({ data: { organization_id: actor.organizationId, name: body.name, description: body.description, payload: body.payload as Prisma.InputJsonValue, created_by_membership_id: actor.membershipId } });
    await audit(tx, { ...auditBase(actor), action: "requisition_template.created", resourceType: "requisition_template", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(template, { status: 201 });
});
