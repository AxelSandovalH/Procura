import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { saleFromDeposit } from "@/lib/bank/ops";
import { assertFeature } from "@/lib/billing/entitlements";
const Body = z.object({ description: z.string().trim().min(1, "Describe la venta o el ingreso").max(300), customer_id: z.uuid().nullable().optional(), tax_percent: z.union([z.literal(0), z.literal(8), z.literal(16)]).default(16) });

/** Un abono sin venta registrada: crea la venta (o ingreso) ya cobrada con el importe y la fecha del banco, y la concilia con el movimiento. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage"); authorize(actor, "payment.manage");
  await assertFeature(actor.organizationId, "bank");
  const body = await json(req, (d) => Body.parse(d));
  const s = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => saleFromDeposit(tx, actor.organizationId, actor.membershipId, params.id, body));
  return NextResponse.json({ sale_id: s.id, folio: s.folio }, { status: 201 });
});
