import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Create = z.object({ code: z.string().trim().toUpperCase().min(1).max(20), name: z.string().trim().min(1).max(60) });

/** Unidades globales (semilla, organization_id null) + propias de la organización. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const units = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.units_of_measure.findMany({
      where: { OR: [{ organization_id: null }, { organization_id: actor.organizationId }], is_active: true },
      orderBy: [{ organization_id: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, organization_id: true },
    }),
  );
  return NextResponse.json({ data: units });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.manage");
  const body = await json(req, (d) => Create.parse(d));

  const unit = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const created = await tx.units_of_measure.create({ data: { organization_id: actor.organizationId, code: body.code, name: body.name } });
    await audit(tx, { ...auditBase(actor), action: "unit.created", resourceType: "unit_of_measure", resourceId: created.id, resourceLabel: created.code });
    return created;
  });
  return NextResponse.json(unit, { status: 201 });
});
