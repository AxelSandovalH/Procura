import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Create = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  item_type: z.enum(["GOOD", "SERVICE"]).default("GOOD"),
  unit_id: z.uuid().optional(),
  unit_label: z.string().trim().min(1).max(40),
  list_price_minor: z.number().int().min(0).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  category_id: z.uuid().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const categoryId = url.searchParams.get("category_id");
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  const items = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_items.findMany({
      where: {
        organization_id: actor.organizationId,
        ...(includeInactive ? {} : { is_active: true }),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { sku: "asc" },
      take: 200,
    }),
  );
  return NextResponse.json({ data: items });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.manage");
  const body = await json(req, (d) => Create.parse(d));

  const item = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    if (body.unit_id) {
      const unit = await tx.units_of_measure.findFirst({ where: { id: body.unit_id, OR: [{ organization_id: null }, { organization_id: actor.organizationId }] } });
      if (!unit) throw Problem.badRequest("unit_id no existe");
    }
    if (body.category_id) {
      const cat = await tx.categories.findFirst({ where: { id: body.category_id, organization_id: actor.organizationId } });
      if (!cat) throw Problem.badRequest("category_id no existe en esta organización");
    }
    const { list_price_minor, attributes, ...rest } = body;
    const created = await tx.catalog_items.create({
      data: {
        organization_id: actor.organizationId, ...rest,
        attributes: attributes as Prisma.InputJsonValue,
        ...(list_price_minor !== undefined ? { list_price_minor: BigInt(list_price_minor) } : {}),
      },
    });
    await audit(tx, { ...auditBase(actor), action: "catalog_item.created", resourceType: "catalog_item", resourceId: created.id, resourceLabel: `${created.sku} — ${created.name}` });
    return created;
  });
  return NextResponse.json(item, { status: 201 });
});
