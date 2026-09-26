import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";
import type { relationship_status } from "@prisma/client";

const Create = z.object({
  counterpart_organization_id: z.uuid(),
  my_position: z.enum(["BUYER", "SUPPLIER"]),
  message: z.string().trim().max(1000).optional(),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.read");
  const url = new URL(req.url);
  const position = url.searchParams.get("position");
  const status = url.searchParams.get("status") as relationship_status | null;

  const relationships = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.relationships.findMany({
      where: {
        ...(position === "BUYER" ? { buyer_organization_id: actor.organizationId }
          : position === "SUPPLIER" ? { supplier_organization_id: actor.organizationId }
          : { OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] }),
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: "desc" },
      include: {
        organizations_relationships_buyer_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
        organizations_relationships_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
      },
    }),
  );
  return NextResponse.json({
    data: relationships.map((r) => ({
      id: r.id, status: r.status, initiated_via: r.initiated_via,
      position: r.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER",
      buyer: r.organizations_relationships_buyer_organization_idToorganizations,
      supplier: r.organizations_relationships_supplier_organization_idToorganizations,
      created_at: r.created_at, accepted_at: r.accepted_at,
    })),
  });
});

/** Inicia una relación por búsqueda (no invitación). `my_position` es el lado del actor. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.request");
  const body = await json(req, (d) => Create.parse(d));
  if (body.counterpart_organization_id === actor.organizationId) throw Problem.badRequest("No puedes crear una relación contigo mismo");

  const buyerId = body.my_position === "BUYER" ? actor.organizationId : body.counterpart_organization_id;
  const supplierId = body.my_position === "BUYER" ? body.counterpart_organization_id : actor.organizationId;

  const relationship = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const counterpart = await tx.organizations.findFirst({ where: { id: body.counterpart_organization_id, status: "ACTIVE" } });
    if (!counterpart) throw Problem.notFound("Organización no encontrada");
    const created = await tx.relationships.create({
      data: { buyer_organization_id: buyerId, supplier_organization_id: supplierId, status: "PENDING", initiated_by_organization_id: actor.organizationId, initiated_via: "SEARCH", request_message: body.message },
    });
    await audit(tx, { ...auditBase(actor), visibleTo: [buyerId, supplierId], action: "relationship.requested", resourceType: "relationship", resourceId: created.id, resourceLabel: counterpart.display_name });
    const counterpartOrgId = body.counterpart_organization_id;
    await emitEvent(tx, {
      type: "relationship.requested", aggregateType: "relationship", aggregateId: created.id, actor,
      recipients: [
        { organizationId: actor.organizationId, perspective: buyerId === actor.organizationId ? "BUYER" : "SUPPLIER", payload: { relationship: { id: created.id, status: "PENDING" } } },
        { organizationId: counterpartOrgId, perspective: buyerId === counterpartOrgId ? "BUYER" : "SUPPLIER", payload: { relationship: { id: created.id, status: "PENDING" } } },
      ],
    });
    await notifyPermissionHolders(tx, { organizationId: counterpartOrgId, permission: "relationship.accept", type: "relationship.requested", title: "Nueva solicitud de relación comercial", resourceType: "relationship", resourceId: created.id });
    return created;
  });
  return NextResponse.json(relationship, { status: 201 });
});
