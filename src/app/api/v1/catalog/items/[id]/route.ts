import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  item_type: z.enum(["GOOD", "SERVICE"]).optional(),
  unit_id: z.uuid().nullable().optional(),
  unit_label: z.string().trim().min(1).max(40).optional(),
  list_price_minor: z.number().int().min(0).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  category_id: z.uuid().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const item = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_items.findFirst({ where: { id: params.id, organization_id: actor.organizationId } }),
  );
  if (!item) throw Problem.notFound();
  return NextResponse.json(item);
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.catalog_items.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    const { attributes, list_price_minor, ...rest } = body;
    const after = await tx.catalog_items.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(attributes !== undefined ? { attributes: attributes as Prisma.InputJsonValue } : {}),
        ...(list_price_minor !== undefined ? { list_price_minor: list_price_minor === null ? null : BigInt(list_price_minor) } : {}),
      },
    });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "catalog_item.updated", resourceType: "catalog_item", resourceId: after.id, resourceLabel: after.sku, changes: changes as Prisma.InputJsonValue });
    return after;
  });
  return NextResponse.json(updated);
});
