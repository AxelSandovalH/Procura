import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import { availableQuotationActions } from "@/lib/sourcing/state";
import type { Prisma } from "@prisma/client";
import { isoDateOptional } from "@/lib/validation";

export async function loadQuotation(tx: Tx, id: string, orgId: string) {
  const q = await tx.quotations.findFirst({
    where: { id, OR: [{ buyer_organization_id: orgId }, { supplier_organization_id: orgId }] },
    include: { quotation_lines: { orderBy: { line_number: "asc" } } },
  });
  if (!q) throw Problem.notFound();
  return q;
}

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const q = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => loadQuotation(tx, params.id, actor.organizationId));
  return NextResponse.json({ ...q, perspective: q.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER", available_actions: availableQuotationActions(q, actor) });
});

const Update = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  tax_minor: z.number().int().min(0).optional(),
  valid_until: isoDateOptional,
  lead_time_days: z.number().int().min(0).nullable().optional(),
  delivery_terms: z.string().trim().max(1000).nullable().optional(),
  payment_terms: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden("Requiere el permiso quotation.submit");
    if (before.status !== "DRAFT") throw Problem.conflict(`No se puede editar en estado ${before.status}`);

    const after = await tx.quotations.update({
      where: { id: before.id },
      data: { ...body, ...(body.tax_minor !== undefined ? { total_minor: before.subtotal_minor + BigInt(body.tax_minor) } : {}) },
    });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), visibleTo: [before.buyer_organization_id, before.supplier_organization_id], action: "quotation.updated", resourceType: "quotation", resourceId: after.id, resourceLabel: after.quotation_number, changes: changes as Prisma.InputJsonValue });
    return tx.quotations.findUniqueOrThrow({ where: { id: before.id } });
  });
  return NextResponse.json(updated);
});
