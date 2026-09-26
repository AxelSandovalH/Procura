import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const delivery = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.deliveries.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] }, include: { delivery_lines: true, receipts: { include: { receipt_lines: true } } } }),
  );
  if (!delivery) throw Problem.notFound();
  return NextResponse.json({ ...delivery, perspective: delivery.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER" });
});

const Update = z.object({
  delivered_at: z.iso.datetime().or(z.iso.date()).transform((s) => new Date(s)).optional(),
  carrier: z.string().trim().max(120).nullable().optional(),
  tracking_ref: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** Editable por el proveedor solo mientras la recepción siga PENDING (OD-31). */
export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Update.parse(d));
  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.deliveries.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId }, include: { receipts: true } });
    if (!before) throw Problem.notFound();
    if (!actor.permissions.has("delivery.register")) throw Problem.forbidden();
    if (before.status !== "REGISTERED" || before.receipts?.status !== "PENDING") throw Problem.conflict("Solo se puede editar mientras la recepción esté pendiente");
    const after = await tx.deliveries.update({ where: { id: before.id }, data: body });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), visibleTo: [before.buyer_organization_id, before.supplier_organization_id], action: "delivery.updated", resourceType: "delivery", resourceId: after.id, resourceLabel: `#${after.delivery_number}`, changes: changes as Prisma.InputJsonValue });
    return after;
  });
  return NextResponse.json(updated);
});
