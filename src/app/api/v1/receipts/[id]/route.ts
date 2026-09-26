import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const receipt = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.receipts.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] }, include: { receipt_lines: true } }),
  );
  if (!receipt) throw Problem.notFound();
  return NextResponse.json({ ...receipt, perspective: receipt.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER" });
});
