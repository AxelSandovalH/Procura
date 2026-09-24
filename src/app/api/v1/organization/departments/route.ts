import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).optional(),
  parent_id: z.uuid().optional(),
});

/** Lectura abierta a cualquier membership activa: casi todos los roles necesitan listar departamentos
 *  para asignar scopes, elegir el de una requisición, etc. La escritura sí exige department.manage. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const departments = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.departments.findMany({
      where: { organization_id: actor.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, parent_id: true, head_membership_id: true, is_active: true },
    }),
  );
  return NextResponse.json({ data: departments });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "department.manage");
  const body = await json(req, (d) => Create.parse(d));

  const dept = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    if (body.parent_id) {
      const parent = await tx.departments.findFirst({ where: { id: body.parent_id, organization_id: actor.organizationId } });
      if (!parent) throw Problem.badRequest("parent_id no existe en esta organización");
    }
    const created = await tx.departments.create({
      data: { organization_id: actor.organizationId, name: body.name, code: body.code, parent_id: body.parent_id },
    });
    await audit(tx, { ...auditBase(actor), action: "department.created", resourceType: "department", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(dept, { status: 201 });
});
