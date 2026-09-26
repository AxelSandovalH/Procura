import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recomputeQuotationTotals, computeLineTotal } from "@/lib/sourcing/totals";
import type { Prisma } from "@prisma/client";

const Create = z.object({
  rfq_line_id: z.uuid().optional(),
  line_kind: z.enum(["AS_REQUESTED", "SUBSTITUTE", "ALTERNATIVE_QUANTITY", "ADDITIONAL", "DECLINED"]).default("AS_REQUESTED"),
  supplier_catalog_item_id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  specifications: z.record(z.string(), z.unknown()).default({}),
  quantity: z.number().min(0),
  unit_label: z.string().trim().max(40).default(""),
  unit_price_minor: z.number().int().min(0).default(0),
  lead_time_days: z.number().int().min(0).optional(),
  notes: z.string().trim().max(1000).optional(),
}).refine((l) => (l.line_kind === "ADDITIONAL") === !l.rfq_line_id, { message: "rfq_line_id requerido salvo con line_kind=ADDITIONAL" });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Create.parse(d));

  const line = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden();
    if (q.status !== "DRAFT") throw Problem.conflict(`No se puede editar en estado ${q.status}`);

    if (body.rfq_line_id) {
      const rfqLine = await tx.quotation_request_lines.findFirst({ where: { id: body.rfq_line_id, rfq_id: q.rfq_id } });
      if (!rfqLine) throw Problem.badRequest("rfq_line_id no pertenece a esta RFQ");
    }
    const maxLine = await tx.quotation_lines.aggregate({ where: { quotation_id: q.id }, _max: { line_number: true } });
    const { specifications, ...rest } = body;
    const created = await tx.quotation_lines.create({
      data: {
        quotation_id: q.id, buyer_organization_id: q.buyer_organization_id, supplier_organization_id: actor.organizationId,
        line_number: (maxLine._max.line_number ?? 0) + 1, ...rest, specifications: specifications as Prisma.InputJsonValue,
        line_total_minor: computeLineTotal(body.quantity, body.unit_price_minor),
      },
    });
    await recomputeQuotationTotals(tx, q.id);
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation_line.created", resourceType: "quotation_line", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(line, { status: 201 });
});
