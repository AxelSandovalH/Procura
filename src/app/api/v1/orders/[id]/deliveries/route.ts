import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { registerDelivery } from "@/lib/fulfillment/register-delivery";

const Body = z.object({
  delivered_at: z.iso.datetime().or(z.iso.date()).transform((s) => new Date(s)),
  location_id: z.uuid().optional(),
  carrier: z.string().trim().max(120).optional(),
  tracking_ref: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({ order_line_id: z.uuid(), quantity_delivered: z.number().positive(), notes: z.string().trim().max(500).optional() })).min(1),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const deliveries = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] }, select: { id: true } });
    if (!o) throw Problem.notFound();
    return tx.deliveries.findMany({ where: { order_id: o.id }, orderBy: { delivery_number: "asc" }, include: { delivery_lines: true, receipts: true } });
  });
  return NextResponse.json({ data: deliveries });
});

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Body.parse(d));
  const delivery = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!o) throw Problem.notFound();
    if (!actor.permissions.has("delivery.register")) throw Problem.forbidden();
    // location_id referencia una localización del COMPRADOR; no se valida aquí porque
    // `locations` es INTERNAL y el contexto RLS de este request es el del proveedor (RLS
    // bloquearía la lectura cruzada). Se acepta tal cual: es metadato, no un límite de seguridad.
    const created = await registerDelivery(tx, o.id, body, actor.membershipId);
    await audit(tx, { ...auditBase(actor), visibleTo: [o.buyer_organization_id, o.supplier_organization_id], action: "delivery.created", resourceType: "delivery", resourceId: created.id, resourceLabel: `#${created.delivery_number}` });
    return created;
  });
  return NextResponse.json(delivery, { status: 201 });
});
