import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { generateWebhookSecret } from "@/lib/events/webhook-secret";

const Create = z.object({
  url: z.url().regex(/^https:\/\//, "Debe ser HTTPS"),
  event_types: z.array(z.string()).min(1).default(["*"]),
  payload_mode: z.enum(["full", "thin"]).default("full"),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  const endpoints = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.webhook_endpoints.findMany({ where: { organization_id: actor.organizationId }, orderBy: { created_at: "desc" }, select: { id: true, url: true, event_types: true, payload_mode: true, is_active: true, consecutive_failures: true, disabled_reason: true, created_at: true } }),
  );
  return NextResponse.json({ data: endpoints });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  const body = await json(req, (d) => Create.parse(d));
  const { secret } = generateWebhookSecret();

  const endpoint = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const created = await tx.webhook_endpoints.create({ data: { organization_id: actor.organizationId, url: body.url, secret_hash: secret, event_types: body.event_types, payload_mode: body.payload_mode, created_by_membership_id: actor.membershipId } });
    await audit(tx, { ...auditBase(actor), action: "webhook.created", resourceType: "webhook_endpoint", resourceId: created.id, resourceLabel: created.url });
    return created;
  });
  return NextResponse.json({ ...endpoint, secret }, { status: 201 });
});
