import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recomputeSale } from "@/lib/finance/ops";
import { saleView } from "@/lib/finance/views";

const Body = z.object({ reason: z.string().trim().min(1).max(300) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  const { reason } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const p = await tx.payments.findFirst({ where: { id: params.pid, sale_id: params.id, organization_id: actor.organizationId } });
    if (!p) throw Problem.notFound();
    if (p.voided_at) throw Problem.conflict("El cobro ya está anulado");
    await tx.payments.update({ where: { id: p.id }, data: { voided_at: new Date(), void_reason: reason } });
    const sale = await recomputeSale(tx, params.id);
    await audit(tx, { ...auditBase(actor), action: "payment.voided", resourceType: "sale", resourceId: params.id, resourceLabel: sale.folio, reason, metadata: { payment_id: p.id, amount_minor: p.amount_minor.toString() } });
    return saleView(tx, sale);
  });
  return NextResponse.json(out);
});
