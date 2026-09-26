import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import type { quotation_status } from "@prisma/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "quotation.read");
  const status = new URL(req.url).searchParams.get("status") as quotation_status | null;

  const quotations = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.requisitions.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true } });
    if (!r) throw Problem.notFound();
    return tx.quotations.findMany({
      where: { buyer_organization_id: actor.organizationId, quotation_requests: { requisition_id: r.id }, ...(status ? { status } : {}) },
      include: {
        quotation_lines: { orderBy: { line_number: "asc" }, include: { quotation_request_lines: { select: { requisition_concept_id: true } } } },
        quotation_requests: { select: { id: true, rfq_number: true } },
        organizations_quotations_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
      },
      orderBy: { created_at: "desc" },
    });
  });
  return NextResponse.json({
    data: quotations.map((q) => ({
      id: q.id, quotation_number: q.quotation_number, version: q.version, status: q.status, currency: q.currency,
      subtotal_minor: q.subtotal_minor, tax_minor: q.tax_minor, total_minor: q.total_minor, valid_until: q.valid_until, lead_time_days: q.lead_time_days,
      supplier: q.organizations_quotations_supplier_organization_idToorganizations, rfq: q.quotation_requests,
      lines: q.quotation_lines.map(({ quotation_request_lines, ...l }) => ({ ...l, requisition_concept_id: quotation_request_lines?.requisition_concept_id ?? null })),
    })),
  });
});
