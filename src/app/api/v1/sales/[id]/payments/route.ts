import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { idempotent } from "@/lib/http/idempotency";
import { addPayment } from "@/lib/finance/ops";
import { saleView } from "@/lib/finance/views";

export const PaymentBody = z.object({
  paid_at: z.iso.date(), amount_minor: z.number().int().positive(), method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
  external_reference: z.string().trim().max(200).optional(), notes: z.string().trim().max(500).optional(),
});

/** Cobro parcial o total de una venta. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  const body = await json(req, (d) => PaymentBody.parse(d));
  return idempotent(req, actor, { id: params.id, ...body }, async () => {
    const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      const { payment } = await addPayment(tx, actor.organizationId, actor.membershipId, "sale", params.id, { ...body, paid_at: new Date(body.paid_at) });
      await audit(tx, { ...auditBase(actor), action: "payment.created", resourceType: "sale", resourceId: params.id, resourceLabel: (await tx.sales.findUniqueOrThrow({ where: { id: params.id }, select: { folio: true } })).folio, metadata: { payment_id: payment.id, amount_minor: body.amount_minor, method: body.method } });
      const sale = await tx.sales.findUniqueOrThrow({ where: { id: params.id } });
      return saleView(tx, sale);
    });
    return { status: 201, body: out };
  });
});
