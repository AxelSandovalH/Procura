import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { idempotent } from "@/lib/http/idempotency";
import { addPayment } from "@/lib/finance/ops";
import { expenseView } from "@/lib/billing/expenses";
import { PaymentBody } from "../../../sales/[id]/payments/route";

/** Pago parcial o total de un gasto. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  const body = await json(req, (d) => PaymentBody.parse(d));
  return idempotent(req, actor, { id: params.id, ...body }, async () => {
    const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      const { payment } = await addPayment(tx, actor.organizationId, actor.membershipId, "expense", params.id, { ...body, paid_at: new Date(body.paid_at) });
      const e = await tx.expenses.findUniqueOrThrow({ where: { id: params.id } });
      await audit(tx, { ...auditBase(actor), action: "payment.created", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { payment_id: payment.id, amount_minor: body.amount_minor, method: body.method } });
      return expenseView(tx, e);
    });
    return { status: 201, body: out };
  });
});
