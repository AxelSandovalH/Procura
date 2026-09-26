import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";

/** Envía un evento webhook.ping — el mismo camino del outbox, no un atajo directo al endpoint. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  const eventId = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const endpoint = await tx.webhook_endpoints.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!endpoint) throw Problem.notFound();
    return emitEvent(tx, {
      type: "webhook.ping", aggregateType: "webhook_endpoint", aggregateId: endpoint.id, actor,
      recipients: [{ organizationId: actor.organizationId, perspective: "OWNER", payload: { message: "ping desde Procura", endpoint_id: endpoint.id } }],
    });
  });
  return NextResponse.json({ event_key: eventId, message: "Encolado; el cron lo despachará en el próximo ciclo (hasta 1 minuto)." });
});
