import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.read");
  const r = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.relationships.findFirst({
      where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] },
      include: {
        organizations_relationships_buyer_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
        organizations_relationships_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
        relationship_terms: true,
      },
    }),
  );
  if (!r) throw Problem.notFound();
  return NextResponse.json({
    id: r.id, status: r.status, initiated_via: r.initiated_via, initiated_by_organization_id: r.initiated_by_organization_id,
    position: r.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER",
    buyer: r.organizations_relationships_buyer_organization_idToorganizations,
    supplier: r.organizations_relationships_supplier_organization_idToorganizations,
    terms: r.relationship_terms,
    request_message: r.request_message,
    created_at: r.created_at, accepted_at: r.accepted_at,
    suspended_at: r.suspended_at, suspended_reason: r.suspended_reason,
    finalized_at: r.finalized_at, finalized_reason: r.finalized_reason,
    rejected_at: r.rejected_at, rejected_reason: r.rejected_reason,
  });
});
