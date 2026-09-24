import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  contact_name: z.string().trim().max(120).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  is_delivery_point: z.boolean().optional(),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const locations = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.locations.findMany({
      where: { organization_id: actor.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, address: true, contact_name: true, contact_phone: true, is_delivery_point: true, is_active: true },
    }),
  );
  return NextResponse.json({ data: locations });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "location.manage");
  const body = await json(req, (d) => Create.parse(d));

  const loc = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const created = await tx.locations.create({ data: { organization_id: actor.organizationId, ...body, address: (body.address ?? {}) as Prisma.InputJsonValue } });
    await audit(tx, { ...auditBase(actor), action: "location.created", resourceType: "location", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(loc, { status: 201 });
});
