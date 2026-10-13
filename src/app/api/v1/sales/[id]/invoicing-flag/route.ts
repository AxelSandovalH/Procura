import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { saleView } from "@/lib/finance/views";

const Body = z.object({ flag: z.enum(["PENDING", "INCIDENT"]).nullable() });

/** Marca manual de «facturación pendiente» o «incidencia»; lo demás se deriva de los CFDI ligados. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const { flag } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const s = await tx.sales.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!s) throw Problem.notFound();
    if (s.voided_at) throw Problem.conflict("La venta está anulada");
    const updated = await tx.sales.update({ where: { id: s.id }, data: { invoicing_flag: flag, updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "sale.invoicing_flag_set", resourceType: "sale", resourceId: s.id, resourceLabel: s.folio, metadata: { flag } });
    return saleView(tx, updated);
  });
  return NextResponse.json(out);
});
