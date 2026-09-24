import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireUser } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit } from "@/lib/audit";

const Body = z.object({ organization_id: z.uuid().optional(), slug: z.string().optional() }).refine((v) => v.organization_id || v.slug, { message: "organization_id o slug es requerido" });

/** Un usuario pide unirse a una organización sin invitación (solo si su política lo permite). */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await json(req, (d) => Body.parse(d));

  const org = await withContext({ userId: user.id }, (tx) =>
    tx.organizations.findFirst({
      where: body.organization_id ? { id: body.organization_id } : { slug: body.slug },
      include: { organization_settings: true },
    }),
  );
  if (!org) throw Problem.notFound("Organización no encontrada");
  if (org.organization_settings?.membership_join_policy !== "REQUEST_APPROVAL") {
    throw Problem.forbidden("Esta organización solo admite miembros por invitación");
  }

  const membership = await withContext({ userId: user.id, organizationId: org.id }, async (tx) => {
    const existing = await tx.memberships.findUnique({ where: { user_id_organization_id: { user_id: user.id, organization_id: org.id } } });
    if (existing && ["ACTIVE", "PENDING", "SUSPENDED"].includes(existing.status)) {
      throw Problem.conflict(`Ya tienes una membresía en esta organización (${existing.status})`);
    }
    const m = existing
      ? await tx.memberships.update({ where: { id: existing.id }, data: { status: "PENDING", requested_by: "USER", removed_at: null } })
      : await tx.memberships.create({ data: { user_id: user.id, organization_id: org.id, status: "PENDING", requested_by: "USER" } });
    await audit(tx, { actorType: "USER", actorId: user.id, membershipId: m.id, organizationId: org.id, action: "membership.requested", resourceType: "membership", resourceId: m.id, resourceLabel: user.email });
    return m;
  });
  return NextResponse.json({ membership }, { status: 201 });
});
