import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import type { quotation_status } from "@prisma/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as quotation_status | null;
  const rfqId = sp.get("rfq_id");

  const quotations = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.quotations.findMany({
      where: { OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }], ...(status ? { status } : {}), ...(rfqId ? { rfq_id: rfqId } : {}) },
      orderBy: { created_at: "desc" }, take: 100,
    }),
  );
  return NextResponse.json({
    data: quotations.map((q) => ({ ...q, perspective: q.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER" })),
  });
});
