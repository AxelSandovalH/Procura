import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { currentUser, requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { findPortal } from "@/lib/portal/lookup";

/**
 * Pública (sin sesión): nombre y texto de bienvenida del portal. Nunca hay requisiciones anónimas —
 * el `viewer` solo se llena si hay sesión, para que la UI sepa qué paso sigue (login → organización →
 * relación → solicitar).
 */
export const GET = route(async (req, params) => {
  const portal = await findPortal(params.slug);

  let viewer: Record<string, unknown> = { authenticated: false };
  const user = await currentUser().catch(() => null);
  if (user) {
    viewer = { authenticated: true, organization: null, relationship: null, can_request: false };
    const actor = await requireActor(req).catch(() => null);
    if (actor) {
      const relationship = actor.organizationId === portal.organization_id ? null : await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
        tx.relationships.findFirst({ where: { buyer_organization_id: actor.organizationId, supplier_organization_id: portal.organization_id, status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] } }, select: { id: true, status: true } }),
      );
      viewer = {
        authenticated: true, organization: { id: actor.organizationId }, relationship,
        is_own_portal: actor.organizationId === portal.organization_id,
        can_request: relationship?.status === "ACTIVE" && actor.permissions.has("requisition.create"),
        can_join: !relationship && actor.organizationId !== portal.organization_id && actor.permissions.has("relationship.request"),
      };
    }
  }
  return NextResponse.json({ portal: { slug: portal.slug, display_name: portal.display_name, welcome_text: portal.welcome_text, organization_id: portal.organization_id }, viewer });
});
