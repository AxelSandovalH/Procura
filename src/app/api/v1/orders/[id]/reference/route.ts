import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reference: z.string().trim().max(80).nullable() });

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reference } = await json(req, (d) => Body.parse(d));
  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!o) throw Problem.notFound();
    const isBuyer = o.buyer_organization_id === actor.organizationId;
    const after = await tx.orders.update({ where: { id: o.id }, data: isBuyer ? { buyer_reference: reference } : { supplier_reference: reference } });
    await audit(tx, { ...auditBase(actor), visibleTo: [o.buyer_organization_id, o.supplier_organization_id], action: "order.reference_updated", resourceType: "order", resourceId: o.id, resourceLabel: o.order_number });
    return after;
  });
  return NextResponse.json(updated);
});
