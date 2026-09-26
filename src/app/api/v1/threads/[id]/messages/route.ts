import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

function requiredPermission(visibility: "INTERNAL" | "SHARED", action: "read" | "post") {
  if (visibility === "SHARED") return action === "read" ? "conversation.shared.read" : "conversation.shared.post";
  return action === "read" ? "note.internal.read" : "note.internal.post";
}

async function loadVisibleThread(tx: Tx, id: string, actor: { organizationId: string; permissions: Set<string> }) {
  const thread = await tx.threads.findFirst({
    where: { id, OR: [{ organization_id: actor.organizationId }, { buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] },
  });
  if (!thread) throw Problem.notFound();
  return thread;
}

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const since = sp.get("since");
  const messages = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const thread = await loadVisibleThread(tx, params.id, actor);
    if (!actor.permissions.has(requiredPermission(thread.visibility, "read"))) throw Problem.forbidden();
    return tx.messages.findMany({ where: { thread_id: thread.id, ...(since ? { id: { gt: since } } : {}) }, orderBy: { created_at: "asc" }, take: 200 });
  });
  return NextResponse.json({ data: messages });
});

const Create = z.object({ body: z.string().trim().min(1).max(10000) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { body } = await json(req, (d) => Create.parse(d));

  const message = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const thread = await loadVisibleThread(tx, params.id, actor);
    if (!actor.permissions.has(requiredPermission(thread.visibility, "post"))) throw Problem.forbidden();

    const created = await tx.messages.create({
      data: {
        thread_id: thread.id, visibility: thread.visibility, organization_id: thread.organization_id,
        buyer_organization_id: thread.buyer_organization_id, supplier_organization_id: thread.supplier_organization_id,
        author_membership_id: actor.membershipId!, author_organization_id: actor.organizationId, body,
      },
    });
    await audit(tx, {
      ...auditBase(actor), action: thread.visibility === "SHARED" ? "message.posted" : "note.posted", resourceType: "message", resourceId: created.id,
      visibleTo: thread.visibility === "SHARED" ? [thread.buyer_organization_id!, thread.supplier_organization_id!] : [actor.organizationId],
    });

    if (thread.visibility === "SHARED") {
      const counterpartOrgId = thread.buyer_organization_id === actor.organizationId ? thread.supplier_organization_id! : thread.buyer_organization_id!;
      await emitEvent(tx, { type: "message.posted", aggregateType: "thread", aggregateId: thread.id, actor, recipients: [{ organizationId: counterpartOrgId, perspective: counterpartOrgId === thread.buyer_organization_id ? "BUYER" : "SUPPLIER", payload: { thread: { id: thread.id } } }] });
      await notifyPermissionHolders(tx, { organizationId: counterpartOrgId, permission: "conversation.shared.read", type: "message.posted", title: "Nuevo mensaje en una conversación compartida", resourceType: "thread", resourceId: thread.id });
    }
    return created;
  });
  return NextResponse.json(message, { status: 201 });
});
