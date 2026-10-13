import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { refreshInvoiceState } from "@/lib/billing/cancel";
import { assertFeature } from "@/lib/billing/entitlements";

/** Consulta el estado de un CFDI emitido (Vigente, Cancelando, Cancelado) y lo aplica; al confirmarse una cancelación, las ventas ligadas se recalculan. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  await assertFeature(actor.organizationId, "issuing");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => refreshInvoiceState(tx, actor.organizationId, actor.membershipId, params.id));
  return NextResponse.json(out);
});
