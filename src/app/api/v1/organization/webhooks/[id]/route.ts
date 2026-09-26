import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  url: z.url().regex(/^https:\/\//).optional(),
  event_types: z.array(z.string()).min(1).optional(),
  payload_mode: z.enum(["full", "thin"]).optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  const body = await json(req, (d) => Update.parse(d));
  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.webhook_endpoints.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    const data = { ...body, ...(body.is_active === true ? { consecutive_failures: 0, disabled_reason: null } : {}) };
    const after = await tx.webhook_endpoints.update({ where: { id: params.id }, data });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "webhook.updated", resourceType: "webhook_endpoint", resourceId: after.id, resourceLabel: after.url, changes: changes as Prisma.InputJsonValue });
    return { ...after, secret_hash: undefined };
  });
  return NextResponse.json(updated);
});

/** No borra la fila: dejaría huérfano el historial de webhook_deliveries (Cascade). Se desactiva. */
export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const endpoint = await tx.webhook_endpoints.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!endpoint) throw Problem.notFound();
    await tx.webhook_endpoints.update({ where: { id: endpoint.id }, data: { is_active: false, disabled_reason: "Eliminado por el usuario" } });
    await audit(tx, { ...auditBase(actor), action: "webhook.deleted", resourceType: "webhook_endpoint", resourceId: endpoint.id, resourceLabel: endpoint.url });
  });
  return new Response(null, { status: 204 });
});
