import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import { recomputeQuotationTotals, computeLineTotal } from "@/lib/sourcing/totals";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  line_kind: z.enum(["AS_REQUESTED", "SUBSTITUTE", "ALTERNATIVE_QUANTITY", "ADDITIONAL", "DECLINED"]).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  quantity: z.number().min(0).optional(),
  unit_label: z.string().trim().max(40).optional(),
  unit_price_minor: z.number().int().min(0).optional(),
  lead_time_days: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

async function assertEditable(tx: Tx, quotationId: string, orgId: string, actor: { permissions: Set<string> }) {
  const q = await tx.quotations.findFirst({ where: { id: quotationId, supplier_organization_id: orgId } });
  if (!q) throw Problem.notFound();
  if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden();
  if (q.status !== "DRAFT") throw Problem.conflict(`No se puede editar en estado ${q.status}`);
  return q;
}

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await assertEditable(tx, params.id, actor.organizationId, actor);
    const before = await tx.quotation_lines.findFirst({ where: { id: params.lid, quotation_id: q.id } });
    if (!before) throw Problem.notFound();

    const quantity = body.quantity ?? Number(before.quantity);
    const unitPrice = body.unit_price_minor ?? Number(before.unit_price_minor);
    const after = await tx.quotation_lines.update({ where: { id: before.id }, data: { ...body, line_total_minor: computeLineTotal(quantity, unitPrice) } });
    await recomputeQuotationTotals(tx, q.id);
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation_line.updated", resourceType: "quotation_line", resourceId: after.id, resourceLabel: after.name, changes: changes as Prisma.InputJsonValue });
    return after;
  });
  return NextResponse.json(updated);
});

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await assertEditable(tx, params.id, actor.organizationId, actor);
    const line = await tx.quotation_lines.findFirst({ where: { id: params.lid, quotation_id: q.id } });
    if (!line) throw Problem.notFound();
    await tx.quotation_lines.delete({ where: { id: line.id } });
    await recomputeQuotationTotals(tx, q.id);
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation_line.deleted", resourceType: "quotation_line", resourceId: line.id, resourceLabel: line.name });
  });
  return new Response(null, { status: 204 });
});
