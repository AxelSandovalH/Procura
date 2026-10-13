import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { saleView } from "@/lib/finance/views";

const Body = z.object({ reason: z.string().trim().min(1).max(300) });

/** Anular (no borrar). Con cobros vigentes o CFDI ligados no se anula: primero se revierten. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const { reason } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const s = await tx.sales.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!s) throw Problem.notFound();
    if (s.voided_at) throw Problem.conflict("La venta ya está anulada");
    if (s.collected_minor > BigInt(0)) throw Problem.conflict("La venta tiene cobros vigentes; anúlalos antes de anular la venta.");
    if (s.documented_minor > BigInt(0)) throw Problem.conflict("La venta tiene CFDI ligados; desvincúlalos antes de anular la venta.");
    const updated = await tx.sales.update({ where: { id: s.id }, data: { voided_at: new Date(), void_reason: reason, updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "sale.voided", resourceType: "sale", resourceId: s.id, resourceLabel: s.folio, reason });
    return saleView(tx, updated);
  });
  return NextResponse.json(out);
});
