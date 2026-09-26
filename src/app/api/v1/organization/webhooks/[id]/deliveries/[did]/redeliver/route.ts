import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

/** Encola una nueva entrega (intento 1) para el mismo evento; el cron la despacha en su próximo ciclo. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const endpoint = await tx.webhook_endpoints.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!endpoint) throw Problem.notFound();
    const original = await tx.webhook_deliveries.findFirst({ where: { id: params.did, endpoint_id: endpoint.id } });
    if (!original) throw Problem.notFound();
    const retry = await tx.webhook_deliveries.create({ data: { endpoint_id: endpoint.id, organization_id: actor.organizationId, event_id: original.event_id, attempt: 1, status: "PENDING", next_retry_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "webhook.redelivered", resourceType: "webhook_delivery", resourceId: retry.id });
    return retry;
  });
  return NextResponse.json(created, { status: 201 });
});
