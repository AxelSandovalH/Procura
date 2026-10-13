import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { reconcile } from "@/lib/bank/ops";
const Body = z.object({ payment_id: z.uuid().optional(), expense_id: z.uuid().optional(), sale_id: z.uuid().optional() });

/** Concilia el movimiento con un pago ya registrado, o registra el pago/cobro en un gasto/venta con saldo pendiente. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  const body = await json(req, (d) => Body.parse(d));
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => reconcile(tx, actor.organizationId, actor.membershipId, params.id, body));
  return NextResponse.json({ ok: true });
});
