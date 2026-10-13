import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { unlinkCfdi } from "@/lib/finance/ops";
import { saleView } from "@/lib/finance/views";

const Body = z.object({ reason: z.string().trim().min(1).max(300) });

/** Desasociar es una acción auditada y exige motivo. */
export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const { reason } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const link = await unlinkCfdi(tx, actor.organizationId, "sale", params.id, params.lid);
    const sale = await tx.sales.findUniqueOrThrow({ where: { id: params.id } });
    await audit(tx, { ...auditBase(actor), action: "cfdi.unlinked", resourceType: "sale", resourceId: sale.id, resourceLabel: sale.folio, reason, metadata: { cfdi_id: link.cfdi_id, amount_minor: link.amount_minor.toString() } });
    return saleView(tx, sale);
  });
  return NextResponse.json(out);
});
