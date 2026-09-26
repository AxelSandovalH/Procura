import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import type { rfq_status } from "@prisma/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("rfq.issue") && !actor.permissions.has("rfq.read")) throw Problem.forbidden();
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as rfq_status | null;
  const buyerOrgId = sp.get("buyer_organization_id");

  const rfqs = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.quotation_requests.findMany({
      where: { OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }], ...(status ? { status } : {}), ...(buyerOrgId ? { buyer_organization_id: buyerOrgId } : {}) },
      orderBy: { created_at: "desc" },
      include: {
        organizations_quotation_requests_buyer_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
        organizations_quotation_requests_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
      },
      take: 100,
    }),
  );
  return NextResponse.json({
    data: rfqs.map((r) => ({
      id: r.id, rfq_number: r.rfq_number, status: r.status, due_date: r.due_date, required_date: r.required_date,
      perspective: r.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER",
      buyer: r.organizations_quotation_requests_buyer_organization_idToorganizations, supplier: r.organizations_quotation_requests_supplier_organization_idToorganizations,
      created_at: r.created_at,
      requisition_id: r.buyer_organization_id === actor.organizationId ? r.requisition_id : undefined,
    })),
  });
});
