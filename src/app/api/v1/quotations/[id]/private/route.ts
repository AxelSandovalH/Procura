import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

/** Solo el proveedor de la cotización puede ver/editar esto — para el comprador, 404 (nunca 403). */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("quotation.read_private")) throw Problem.forbidden();
  const priv = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    return tx.quotation_supplier_private.findUnique({ where: { quotation_id: q.id } });
  });
  return NextResponse.json(priv ?? {});
});

const Update = z.object({
  assigned_membership_id: z.uuid().nullable().optional(),
  internal_cost_minor: z.number().int().min(0).nullable().optional(),
  margin_pct: z.number().nullable().optional(),
  internal_supplier_ref: z.string().trim().max(200).nullable().optional(),
  internal_notes: z.string().trim().max(2000).nullable().optional(),
});

export const PUT = route(async (req, params) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("quotation.read_private")) throw Problem.forbidden();
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    const after = await tx.quotation_supplier_private.upsert({
      where: { quotation_id: q.id },
      create: { quotation_id: q.id, organization_id: actor.organizationId, ...body },
      update: body,
    });
    await audit(tx, { ...auditBase(actor), action: "quotation_private.updated", resourceType: "quotation", resourceId: q.id });
    return after;
  });
  return NextResponse.json(updated);
});
