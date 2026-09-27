import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

/** Conteos para la lista «Primeros pasos» de Inicio: qué ya está configurado en la organización activa. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.read");
  const org = actor.organizationId;
  const s = await withContext({ userId: actor.userId, organizationId: org }, async (tx) => {
    const [departments, locations, workflows, members, invitations, buyerRels, supplierRels, catalogItems, requisitions, settings] = await Promise.all([
      tx.departments.count({ where: { organization_id: org } }),
      tx.locations.count({ where: { organization_id: org } }),
      tx.approval_workflows.count({ where: { organization_id: org, is_active: true, approval_rules: { some: {} } } }),
      tx.memberships.count({ where: { organization_id: org, status: "ACTIVE" } }),
      tx.invitations.count({ where: { organization_id: org } }),
      tx.relationships.count({ where: { buyer_organization_id: org, status: "ACTIVE" } }),
      tx.relationships.count({ where: { supplier_organization_id: org, status: "ACTIVE" } }),
      tx.catalog_items.count({ where: { organization_id: org } }),
      tx.requisitions.count({ where: { organization_id: org } }),
      tx.organization_settings.findUnique({ where: { organization_id: org }, select: { portal_enabled: true } }),
    ]);
    return { departments, locations, approval_workflows: workflows, members, invitations, suppliers: buyerRels, clients: supplierRels, catalog_items: catalogItems, requisitions, portal_enabled: settings?.portal_enabled ?? false };
  });
  return NextResponse.json(s);
});
