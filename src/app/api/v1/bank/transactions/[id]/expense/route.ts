import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { expenseFromCharge } from "@/lib/bank/ops";
const Body = z.object({ description: z.string().trim().min(1, "Describe el gasto").max(300), category: z.string().trim().max(80).nullable().optional(), supplier_name: z.string().trim().max(200).nullable().optional() });

/** Un cargo sin ticket: crea el gasto ya pagado y lo concilia con el movimiento. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage"); authorize(actor, "payment.manage");
  const body = await json(req, (d) => Body.parse(d));
  const e = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => expenseFromCharge(tx, actor.organizationId, actor.membershipId, params.id, body));
  return NextResponse.json({ expense_id: e.id }, { status: 201 });
});
