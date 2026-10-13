import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { linkCfdi } from "@/lib/finance/ops";
import { saleView } from "@/lib/finance/views";

const Body = z.object({ cfdi_id: z.uuid(), amount_minor: z.number().int().positive().optional() });

/** Liga un CFDI emitido a la venta (importe documentado opcional; por defecto lo que cabe en ambos lados). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const body = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const { link, cfdi } = await linkCfdi(tx, actor.organizationId, actor.membershipId, "sale", params.id, body.cfdi_id, body.amount_minor);
    const sale = await tx.sales.findUniqueOrThrow({ where: { id: params.id } });
    await audit(tx, { ...auditBase(actor), action: "cfdi.linked", resourceType: "sale", resourceId: sale.id, resourceLabel: sale.folio, metadata: { link_id: link.id, cfdi_id: cfdi.id, fiscal_uuid: cfdi.fiscal_uuid, amount_minor: link.amount_minor.toString() } });
    return saleView(tx, sale);
  });
  return NextResponse.json(out, { status: 201 });
});
