import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";

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

const Update = z.object({
  legal_name: z.string().trim().min(2).max(200).optional(),
  display_name: z.string().trim().min(2).max(120).optional(),
  tax_id: z.string().trim().max(20).nullable().optional(),
  is_discoverable: z.boolean().optional(),
});

export const PATCH = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId } });
    const after = await tx.organizations.update({ where: { id: actor.organizationId }, data: body });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) {
      await audit(tx, { ...auditBase(actor), action: "organization.updated", resourceType: "organization", resourceId: after.id, resourceLabel: after.display_name, changes: changes as Prisma.InputJsonValue });
    }
    return after;
  });
  return NextResponse.json(updated);
});
