import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import type { webhook_delivery_status } from "@prisma/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "webhook.manage");
  const status = new URL(req.url).searchParams.get("status") as webhook_delivery_status | null;
  const deliveries = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const endpoint = await tx.webhook_endpoints.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } });
    if (!endpoint) throw Problem.notFound();
    return tx.webhook_deliveries.findMany({ where: { endpoint_id: endpoint.id, ...(status ? { status } : {}) }, orderBy: { created_at: "desc" }, take: 100 });
  });
  return NextResponse.json({ data: deliveries });
});
