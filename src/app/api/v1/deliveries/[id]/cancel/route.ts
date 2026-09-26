import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { reason } = await json(req, (d) => Body.parse(d));
  const delivery = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const d = await tx.deliveries.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId }, include: { delivery_lines: true, receipts: true } });
    if (!d) throw Problem.notFound();
    if (!actor.permissions.has("delivery.register")) throw Problem.forbidden();
    if (d.status !== "REGISTERED" || d.receipts?.status !== "PENDING") throw Problem.conflict("Solo se puede cancelar mientras la recepción esté pendiente");

    for (const l of d.delivery_lines) {
      await tx.order_lines.update({ where: { id: l.order_line_id }, data: { delivered_quantity: { decrement: l.quantity_delivered } } });
    }
    // El Receipt asociado queda PENDING pero inalcanzable: confirm-receipt exige delivery.status
    // REGISTERED, así que una vez CANCELLED nadie puede actuar sobre él. No se fuerza un estado
    // "CONFIRMED" artificial — sería semánticamente falso (nada se recibió).
    const updated = await tx.deliveries.update({ where: { id: d.id }, data: { status: "CANCELLED", cancelled_at: new Date(), cancel_reason: reason } });
    await audit(tx, { ...auditBase(actor), visibleTo: [d.buyer_organization_id, d.supplier_organization_id], action: "delivery.cancelled", resourceType: "delivery", resourceId: d.id, resourceLabel: `#${d.delivery_number}`, reason });
    return updated;
  });
  return NextResponse.json(delivery);
});
