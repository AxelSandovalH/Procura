import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/http/rate-limit";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";
import { findPortal } from "@/lib/portal/lookup";

const Body = z.object({ message: z.string().trim().max(1000).optional() });

/**
 * Login → organización activa → relación. La organización del actor pasa a ser COMPRADORA del portal.
 * Sin invitación la relación nace PENDING: el proveedor la aprueba (con invitación de relación con
 * auto_accept se usa POST /invitations/{token}/accept). Idempotente: si ya hay una relación viva, la devuelve.
 */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  await rateLimit("portal-join", actor.userId ?? actor.organizationId, { windowSeconds: 3600, max: 10 });
  authorize(actor, "relationship.request");
  const { message } = await json(req, (d) => Body.parse(d ?? {}));
  const portal = await findPortal(params.slug);
  if (portal.organization_id === actor.organizationId) throw Problem.badRequest("Este es el portal de tu propia organización");

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const existing = await tx.relationships.findFirst({ where: { buyer_organization_id: actor.organizationId, supplier_organization_id: portal.organization_id, status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] } } });
    if (existing) return { relationship: existing, created: false };

    const created = await tx.relationships.create({
      data: { buyer_organization_id: actor.organizationId, supplier_organization_id: portal.organization_id, status: "PENDING", initiated_by_organization_id: actor.organizationId, initiated_via: "PORTAL", request_message: message },
    });
    await audit(tx, { ...auditBase(actor), visibleTo: [actor.organizationId, portal.organization_id], action: "relationship.requested", resourceType: "relationship", resourceId: created.id, resourceLabel: portal.display_name, metadata: { via: "PORTAL" } });
    await emitEvent(tx, {
      type: "relationship.requested", aggregateType: "relationship", aggregateId: created.id, actor,
      recipients: [
        { organizationId: actor.organizationId, perspective: "BUYER", payload: { relationship: { id: created.id, status: "PENDING", via: "PORTAL" } } },
        { organizationId: portal.organization_id, perspective: "SUPPLIER", payload: { relationship: { id: created.id, status: "PENDING", via: "PORTAL" } } },
      ],
    });
    await notifyPermissionHolders(tx, { organizationId: portal.organization_id, permission: "relationship.accept", type: "relationship.requested", title: "Nueva solicitud de relación desde tu portal", resourceType: "relationship", resourceId: created.id });
    return { relationship: created, created: true };
  });

  return NextResponse.json(
    { relationship: { id: result.relationship.id, status: result.relationship.status }, created: result.created,
      next: result.relationship.status === "ACTIVE" ? "Ya puedes crear tu requisición dirigida (POST /api/v1/requisitions con directed_supplier_organization_id)." : "Solicitud enviada; el proveedor debe aprobarla antes de que puedas solicitar." },
    { status: result.created ? 201 : 200 },
  );
});
