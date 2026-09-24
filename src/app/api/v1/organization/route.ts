import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

/** Organización activa + settings + permisos efectivos del actor. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.read");
  const org = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.organizations.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: {
        id: true, slug: true, legal_name: true, display_name: true, tax_id: true, country: true,
        base_currency: true, timezone: true, is_discoverable: true, status: true, created_at: true,
        organization_settings: true,
      },
    }),
  );
  const { organization_settings, ...rest } = org;
  return NextResponse.json({
    organization: rest,
    settings: organization_settings,
    actor: { type: actor.type, membership_id: actor.membershipId, permissions: [...actor.permissions].sort() },
  });
});
