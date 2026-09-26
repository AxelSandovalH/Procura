import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import type { delivery_status } from "@prisma/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const orderId = sp.get("order_id");
  const status = sp.get("status") as delivery_status | null;

  const deliveries = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.deliveries.findMany({
      where: { OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }], ...(orderId ? { order_id: orderId } : {}), ...(status ? { status } : {}) },
      orderBy: { created_at: "desc" }, take: 100, include: { receipts: true },
    }),
  );
  return NextResponse.json({ data: deliveries.map((d) => ({ ...d, perspective: d.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER" })) });
});
