import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";
import { resolveAnchor, type AnchorType } from "@/lib/collaboration/anchor";
import type { thread_anchor_type, visibility as Visibility } from "@prisma/client";

const ANCHOR_TYPES = ["REQUISITION", "REQUISITION_CONCEPT", "RFQ", "RFQ_LINE", "QUOTATION", "ORDER", "DELIVERY"] as const;

function requiredPermission(visibility: Visibility, action: "read" | "post") {
  if (visibility === "SHARED") return action === "read" ? "conversation.shared.read" : "conversation.shared.post";
  return action === "read" ? "note.internal.read" : "note.internal.post";
}

/** Busca el thread de un ancla+visibilidad. thread:null si aún no hay conversación (no es un error). */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const anchorType = sp.get("anchor_type") as thread_anchor_type | null;
  const anchorId = sp.get("anchor_id");
  const visibility = sp.get("visibility") as Visibility | null;
  if (!anchorType || !anchorId || !visibility) throw Problem.badRequest("anchor_type, anchor_id y visibility son requeridos");
  if (!actor.permissions.has(requiredPermission(visibility, "read"))) throw Problem.forbidden();

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await resolveAnchor(tx, anchorType as AnchorType, anchorId, actor.organizationId);
    const thread = await tx.threads.findFirst({
      where: visibility === "INTERNAL"
        ? { anchor_type: anchorType, anchor_id: anchorId, visibility: "INTERNAL", organization_id: actor.organizationId }
        : { anchor_type: anchorType, anchor_id: anchorId, visibility: "SHARED" },
      include: { messages: { orderBy: { created_at: "asc" }, take: 200 } },
    });
    return thread;
  });
  if (!result) return NextResponse.json({ thread: null, messages: [] });
  return NextResponse.json({ thread: { id: result.id, anchor_type: result.anchor_type, anchor_id: result.anchor_id, visibility: result.visibility, created_at: result.created_at }, messages: result.messages });
});

const Create = z.object({
  anchor_type: z.enum(ANCHOR_TYPES),
  anchor_id: z.uuid(),
  visibility: z.enum(["INTERNAL", "SHARED"]),
  body: z.string().trim().min(1).max(10000),
});

/** El thread se crea implícitamente al primer mensaje (find-or-create), atómico con el mensaje. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Create.parse(d));
  if (body.visibility === "SHARED" && (body.anchor_type === "REQUISITION" || body.anchor_type === "REQUISITION_CONCEPT")) {
    throw Problem.badRequest("La requisición es interna; una conversación compartida debe anclarse a la RFQ");
  }
  if (!actor.permissions.has(requiredPermission(body.visibility, "post"))) throw Problem.forbidden();

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const anchor = await resolveAnchor(tx, body.anchor_type, body.anchor_id, actor.organizationId);
    if (body.visibility === "SHARED" && !anchor.allowsShared) throw Problem.badRequest("Este ancla no admite conversación compartida");

    const thread = await tx.threads.upsert({
      where: body.visibility === "INTERNAL"
        ? { anchor_type_anchor_id_organization_id: { anchor_type: body.anchor_type, anchor_id: body.anchor_id, organization_id: actor.organizationId } }
        : { anchor_type_anchor_id: { anchor_type: body.anchor_type, anchor_id: body.anchor_id } },
      create: {
        anchor_type: body.anchor_type, anchor_id: body.anchor_id, visibility: body.visibility,
        organization_id: body.visibility === "INTERNAL" ? actor.organizationId : null,
        relationship_id: body.visibility === "SHARED" ? anchor.relationshipId : null,
        buyer_organization_id: body.visibility === "SHARED" ? anchor.buyerOrganizationId : null,
        supplier_organization_id: body.visibility === "SHARED" ? anchor.supplierOrganizationId : null,
      },
      update: {},
    });

    const message = await tx.messages.create({
      data: {
        thread_id: thread.id, visibility: body.visibility,
        organization_id: body.visibility === "INTERNAL" ? actor.organizationId : null,
        buyer_organization_id: body.visibility === "SHARED" ? anchor.buyerOrganizationId : null,
        supplier_organization_id: body.visibility === "SHARED" ? anchor.supplierOrganizationId : null,
        author_membership_id: actor.membershipId!, author_organization_id: actor.organizationId, body: body.body,
      },
    });
    await audit(tx, {
      ...auditBase(actor), action: body.visibility === "SHARED" ? "message.posted" : "note.posted", resourceType: "message", resourceId: message.id,
      visibleTo: body.visibility === "SHARED" ? [anchor.buyerOrganizationId!, anchor.supplierOrganizationId!] : [actor.organizationId],
    });

    if (body.visibility === "SHARED") {
      const counterpartOrgId = anchor.buyerOrganizationId === actor.organizationId ? anchor.supplierOrganizationId! : anchor.buyerOrganizationId!;
      await emitEvent(tx, {
        type: "message.posted", aggregateType: "thread", aggregateId: thread.id, actor,
        recipients: [{ organizationId: counterpartOrgId, perspective: counterpartOrgId === anchor.buyerOrganizationId ? "BUYER" : "SUPPLIER", payload: { thread: { id: thread.id, anchor_type: body.anchor_type, anchor_id: body.anchor_id } } }],
      });
      await notifyPermissionHolders(tx, { organizationId: counterpartOrgId, permission: "conversation.shared.read", type: "message.posted", title: "Nuevo mensaje en una conversación compartida", resourceType: "thread", resourceId: thread.id });
    }
    return { thread, message };
  });
  return NextResponse.json(result, { status: 201 });
});
