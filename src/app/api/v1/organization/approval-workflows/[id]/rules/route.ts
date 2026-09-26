import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Condition = z.object({
  min_amount_minor: z.number().int().min(0).optional(),
  max_amount_minor: z.number().int().min(0).optional(),
  department_ids: z.array(z.uuid()).optional(),
  requisition_types: z.array(z.enum(["GOODS", "SERVICE", "MIXED"])).optional(),
}).default({});

const Create = z.object({
  level: z.number().int().min(1),
  condition: Condition,
  approver_type: z.enum(["ROLE", "MEMBERSHIP", "DEPARTMENT_HEAD"]),
  approver_role_id: z.uuid().optional(),
  approver_membership_id: z.uuid().optional(),
  approver_scope_policy: z.enum(["MATCH_REQUISITION_SCOPE", "ANY"]).default("MATCH_REQUISITION_SCOPE"),
  decision_mode: z.enum(["ANY_ONE", "ALL"]).default("ANY_ONE"),
}).refine((v) => {
  if (v.approver_type === "ROLE") return !!v.approver_role_id && !v.approver_membership_id;
  if (v.approver_type === "MEMBERSHIP") return !!v.approver_membership_id && !v.approver_role_id;
  return !v.approver_role_id && !v.approver_membership_id;
}, { message: "approver_role_id/approver_membership_id deben corresponder a approver_type" });

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "approval_workflow.manage");
  const rules = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.approval_rules.findMany({ where: { workflow_id: params.id, organization_id: actor.organizationId }, orderBy: { level: "asc" } }),
  );
  return NextResponse.json({ data: rules });
});

/** Valida en configuración que exista al menos un posible aprobador (OD-09): evita niveles muertos. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "approval_workflow.manage");
  const body = await json(req, (d) => Create.parse(d));

  const rule = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const workflow = await tx.approval_workflows.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!workflow) throw Problem.notFound();

    if (body.approver_type === "ROLE" && body.approver_role_id) {
      const role = await tx.roles.findFirst({ where: { id: body.approver_role_id, organization_id: actor.organizationId, is_active: true } });
      if (!role) throw Problem.badRequest("approver_role_id no existe o está inactivo");
      const any = await tx.role_assignments.findFirst({ where: { organization_id: actor.organizationId, role_id: role.id, revoked_at: null, memberships_role_assignments_membership_idTomemberships: { status: "ACTIVE" } } });
      if (!any) throw Problem.badRequest(`El rol "${role.name}" no tiene ningún miembro activo asignado; configúralo antes de crear este nivel`);
    }
    if (body.approver_type === "MEMBERSHIP" && body.approver_membership_id) {
      const m = await tx.memberships.findFirst({ where: { id: body.approver_membership_id, organization_id: actor.organizationId, status: "ACTIVE" } });
      if (!m) throw Problem.badRequest("approver_membership_id no es un miembro activo");
    }

    const created = await tx.approval_rules.create({ data: { workflow_id: workflow.id, organization_id: actor.organizationId, ...body, condition: body.condition as Prisma.InputJsonValue } });
    await audit(tx, { ...auditBase(actor), action: "approval_rule.created", resourceType: "approval_rule", resourceId: created.id, resourceLabel: `nivel ${created.level}` });
    return created;
  });
  return NextResponse.json(rule, { status: 201 });
});
