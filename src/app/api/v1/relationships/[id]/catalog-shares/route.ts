import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Create = z.object({ catalog_item_id: z.uuid().optional(), category_id: z.uuid().optional(), show_price: z.boolean().default(false) })
  .refine((v) => (v.catalog_item_id ? 1 : 0) + (v.category_id ? 1 : 0) === 1, { message: "Debes indicar exactamente uno: catalog_item_id o category_id" });

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.read");
  const shares = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    return tx.catalog_shares.findMany({ where: { relationship_id: r.id, is_active: true }, include: { catalog_items: { select: { id: true, sku: true, name: true } }, categories: { select: { id: true, name: true } } } });
  });
  return NextResponse.json({ data: shares });
});

/** Solo el proveedor de la relación puede compartir su catálogo (catalog.share, side=SUPPLIER). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Create.parse(d));

  const share = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (r.supplier_organization_id !== actor.organizationId) throw Problem.forbidden("Solo el proveedor de la relación puede compartir su catálogo");
    if (!actor.permissions.has("catalog.share")) throw Problem.forbidden("Requiere el permiso catalog.share");
    if (r.status !== "ACTIVE") throw Problem.conflict(`La relación está en estado ${r.status}, no ACTIVE`);

    if (body.catalog_item_id) {
      const item = await tx.catalog_items.findFirst({ where: { id: body.catalog_item_id, organization_id: actor.organizationId } });
      if (!item) throw Problem.badRequest("catalog_item_id no existe en tu catálogo");
    }
    if (body.category_id) {
      const cat = await tx.categories.findFirst({ where: { id: body.category_id, organization_id: actor.organizationId } });
      if (!cat) throw Problem.badRequest("category_id no existe en tu catálogo");
    }
    const created = await tx.catalog_shares.create({
      data: { relationship_id: r.id, buyer_organization_id: r.buyer_organization_id, supplier_organization_id: r.supplier_organization_id, ...body, created_by_membership_id: actor.membershipId },
    });
    await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "catalog_share.created", resourceType: "catalog_share", resourceId: created.id });
    return created;
  });
  return NextResponse.json(share, { status: 201 });
});
