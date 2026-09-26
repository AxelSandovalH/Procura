import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { issueRfqs } from "@/lib/sourcing/issue-rfq";
import { isoDateOptional } from "@/lib/validation";

const Create = z.object({
  supplier_organization_ids: z.array(z.uuid()).min(1),
  due_date: isoDateOptional,
  message: z.string().trim().max(2000).optional(),
  concept_ids: z.array(z.uuid()).optional(),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "rfq.issue");
  const rfqs = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } });
    if (!r) throw Problem.notFound();
    return tx.quotation_requests.findMany({
      where: { requisition_id: r.id }, orderBy: { created_at: "desc" },
      include: { organizations_quotation_requests_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } } },
    });
  });
  return NextResponse.json({ data: rfqs });
});

/**
 * Emite una RFQ por proveedor: proyecta SOLO los campos compartidos de cada concepto
 * (nunca budget_minor ni estimated_unit_price_minor — esos quedan en requisition_concepts).
 */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "rfq.issue");
  const body = await json(req, (d) => Create.parse(d));

  const created = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    issueRfqs(tx, actor, params.id, body.supplier_organization_ids, { dueDate: body.due_date, message: body.message, conceptIds: body.concept_ids }),
  );
  return NextResponse.json({ data: created }, { status: 201 });
});
