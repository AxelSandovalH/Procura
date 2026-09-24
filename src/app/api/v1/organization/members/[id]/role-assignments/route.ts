import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Create = z.object({
  role_id: z.uuid(),
  scope_type: z.enum(["ORGANIZATION", "DEPARTMENT", "LOCATION", "RELATIONSHIP", "CATEGORY", "COST_CENTER", "OPERATION_TYPE"]).default("ORGANIZATION"),
  scope_id: z.uuid().optional(),
}).refine((v) => (v.scope_type === "ORGANIZATION") === (v.scope_id === undefined), {
  message: "scope_id es requerido salvo con scope_type ORGANIZATION",
  path: ["scope_id"],
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "role.read");
  const assignments = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.role_assignments.findMany({
      where: { membership_id: params.id, organization_id: actor.organizationId, revoked_at: null },
      select: { id: true, scope_type: true, scope_id: true, granted_at: true, roles: { select: { id: true, name: true } } },
    }),
  );
  return NextResponse.json({ data: assignments });
});

/**
 * No-escalación (RBAC.md §5): el actor solo puede asignar un rol cuyo conjunto de permisos
 * sea subconjunto de sus propios permisos efectivos — evita que un delegado se auto-otorgue Administrador.
 */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "role.assign");
  const body = await json(req, (d) => Create.parse(d));

  const assignment = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const target = await tx.memberships.findFirst({ where: { id: params.id, organization_id: actor.organizationId, status: "ACTIVE" } });
    if (!target) throw Problem.notFound();

    const role = await tx.roles.findFirst({
      where: { id: body.role_id, organization_id: actor.organizationId, is_active: true },
      include: { role_permissions: { select: { permission_code: true } } },
    });
    if (!role) throw Problem.badRequest("role_id no existe o está inactivo");

    const escalates = role.role_permissions.some((p) => !actor.permissions.has(p.permission_code as never));
    if (escalates) throw Problem.forbidden("No puedes asignar un rol con permisos que tú mismo no tienes");

    if (body.scope_type === "DEPARTMENT" && body.scope_id) {
      const dept = await tx.departments.findFirst({ where: { id: body.scope_id, organization_id: actor.organizationId } });
      if (!dept) throw Problem.badRequest("scope_id no es un departamento de esta organización");
    }
    if (body.scope_type === "LOCATION" && body.scope_id) {
      const loc = await tx.locations.findFirst({ where: { id: body.scope_id, organization_id: actor.organizationId } });
      if (!loc) throw Problem.badRequest("scope_id no es una localización de esta organización");
    }

    const created = await tx.role_assignments.create({
      data: { organization_id: actor.organizationId, membership_id: target.id, role_id: role.id, scope_type: body.scope_type, scope_id: body.scope_id ?? null, granted_by_membership_id: actor.membershipId },
    });
    await audit(tx, { ...auditBase(actor), action: "role_assignment.granted", resourceType: "role_assignment", resourceId: created.id, resourceLabel: `${role.name} @ ${body.scope_type}`, changes: { membership_id: target.id, role_id: role.id, scope_type: body.scope_type, scope_id: body.scope_id ?? null } });
    return created;
  });
  return NextResponse.json(assignment, { status: 201 });
});
