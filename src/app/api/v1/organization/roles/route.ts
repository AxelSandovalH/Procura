import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/auth/permissions";

const Create = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  permission_codes: z.array(z.enum(PERMISSIONS)).default([]),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "role.read");
  const roles = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.roles.findMany({
      where: { organization_id: actor.organizationId },
      orderBy: [{ is_system: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, is_system: true, is_active: true, role_permissions: { select: { permission_code: true } } },
    }),
  );
  return NextResponse.json({ data: roles.map((r) => ({ ...r, role_permissions: undefined, permission_codes: r.role_permissions.map((p) => p.permission_code) })) });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "role.manage");
  const body = await json(req, (d) => Create.parse(d));

  const role = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const created = await tx.roles.create({
      data: {
        organization_id: actor.organizationId, name: body.name, description: body.description, is_system: false,
        role_permissions: { create: body.permission_codes.map((code) => ({ permission_code: code, organization_id: actor.organizationId })) },
      },
    });
    await audit(tx, { ...auditBase(actor), action: "role.created", resourceType: "role", resourceId: created.id, resourceLabel: created.name, changes: { permission_codes: body.permission_codes } });
    return created;
  });
  return NextResponse.json({ ...role, permission_codes: body.permission_codes }, { status: 201 });
});
