import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);

  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const invitation = await tx.invitations.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!invitation) throw Problem.notFound();
    authorize(actor, invitation.kind === "MEMBERSHIP" ? "member.invite" : "relationship.request");
    if (invitation.status !== "ACTIVE") throw Problem.conflict(`La invitación está en estado ${invitation.status}`);
    await tx.invitations.update({ where: { id: invitation.id }, data: { status: "REVOKED", revoked_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "invitation.revoked", resourceType: "invitation", resourceId: invitation.id, resourceLabel: invitation.kind });
  });
  return new Response(null, { status: 204 });
});
