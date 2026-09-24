import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
  permission_codes: z.array(z.enum(PERMISSIONS)).optional(),
});

/** Editar un rol (incluidos los base, `is_system`): se pueden cambiar permisos, no eliminar el rol. */
export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "role.manage");
  const body = await json(req, (d) => Update.parse(d));

  const role = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.roles.findFirst({
      where: { id: params.id, organization_id: actor.organizationId },
      include: { role_permissions: { select: { permission_code: true } } },
    });
    if (!before) throw Problem.notFound();

    const { permission_codes, ...rest } = body;
    const changes: Record<string, unknown> = {};
    if (rest.name !== undefined && rest.name !== before.name) changes.name = { from: before.name, to: rest.name };
    if (rest.is_active !== undefined && rest.is_active !== before.is_active) changes.is_active = { from: before.is_active, to: rest.is_active };

    if (permission_codes) {
      const beforeSet = new Set(before.role_permissions.map((p) => p.permission_code));
      const afterSet: Set<string> = new Set(permission_codes);
      if (beforeSet.size !== afterSet.size || [...beforeSet].some((c) => !afterSet.has(c))) {
        await tx.role_permissions.deleteMany({ where: { role_id: params.id } });
        await tx.role_permissions.createMany({ data: permission_codes.map((code) => ({ role_id: params.id, permission_code: code, organization_id: actor.organizationId })) });
        changes.permission_codes = { from: [...beforeSet], to: [...afterSet] };
      }
    }

    const updated = await tx.roles.update({ where: { id: params.id }, data: rest });
    if (Object.keys(changes).length > 0) {
      await audit(tx, { ...auditBase(actor), action: "role.updated", resourceType: "role", resourceId: updated.id, resourceLabel: updated.name, changes: changes as Prisma.InputJsonValue });
    }
    const finalPermissions = await tx.role_permissions.findMany({ where: { role_id: updated.id }, select: { permission_code: true } });
    return { ...updated, permission_codes: finalPermissions.map((p) => p.permission_code) };
  });
  return NextResponse.json(role);
});
