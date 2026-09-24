import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "role.assign");

  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const assignment = await tx.role_assignments.findFirst({
      where: { id: params.assignmentId, membership_id: params.id, organization_id: actor.organizationId, revoked_at: null },
      include: { roles: { select: { name: true } } },
    });
    if (!assignment) throw Problem.notFound();
    if (assignment.membership_id === actor.membershipId && assignment.roles.name === "Administrador") {
      const remaining = await tx.role_assignments.count({
        where: { organization_id: actor.organizationId, revoked_at: null, roles: { name: "Administrador" }, id: { not: assignment.id } },
      });
      if (remaining === 0) throw Problem.conflict("No puedes revocar el único rol Administrador restante de la organización");
    }
    await tx.role_assignments.update({ where: { id: assignment.id }, data: { revoked_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "role_assignment.revoked", resourceType: "role_assignment", resourceId: assignment.id, resourceLabel: assignment.roles.name });
  });
  return new Response(null, { status: 204 });
});
