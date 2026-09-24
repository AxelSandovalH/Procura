import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Create = z.object({ name: z.string().trim().min(1).max(120), parent_id: z.uuid().optional() });

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const categories = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.categories.findMany({ where: { organization_id: actor.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, parent_id: true, is_active: true } }),
  );
  return NextResponse.json({ data: categories });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.manage");
  const body = await json(req, (d) => Create.parse(d));

  const category = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    if (body.parent_id) {
      const parent = await tx.categories.findFirst({ where: { id: body.parent_id, organization_id: actor.organizationId } });
      if (!parent) throw Problem.badRequest("parent_id no existe en esta organización");
    }
    const created = await tx.categories.create({ data: { organization_id: actor.organizationId, name: body.name, parent_id: body.parent_id } });
    await audit(tx, { ...auditBase(actor), action: "category.created", resourceType: "category", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(category, { status: 201 });
});
