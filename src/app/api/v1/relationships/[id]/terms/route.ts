import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  payment_terms: z.string().trim().max(500).nullable().optional(),
  quotation_instructions: z.string().trim().max(2000).nullable().optional(),
  lead_time_days: z.number().int().min(0).nullable().optional(),
});

async function loadRelationship(tx: Tx, id: string, orgId: string) {
  const r = await tx.relationships.findFirst({ where: { id, OR: [{ buyer_organization_id: orgId }, { supplier_organization_id: orgId }] } });
  if (!r) throw Problem.notFound();
  return r;
}

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.read");
  const terms = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await loadRelationship(tx, params.id, actor.organizationId);
    return tx.relationship_terms.findUnique({ where: { relationship_id: params.id } });
  });
  return NextResponse.json(terms ?? {});
});

/** Cualquiera de las dos organizaciones puede editar los términos; queda auditado y visible a ambas. */
export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await loadRelationship(tx, params.id, actor.organizationId);
    if (r.status === "FINALIZED") throw Problem.conflict("La relación está finalizada");
    const before = await tx.relationship_terms.findUnique({ where: { relationship_id: r.id } });
    const after = await tx.relationship_terms.upsert({
      where: { relationship_id: r.id },
      create: { relationship_id: r.id, buyer_organization_id: r.buyer_organization_id, supplier_organization_id: r.supplier_organization_id, ...body, updated_by_membership_id: actor.membershipId },
      update: { ...body, updated_by_membership_id: actor.membershipId },
    });
    const changes = diff((before ?? {}) as Record<string, unknown>, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) {
      await audit(tx, { ...auditBase(actor), visibleTo: [r.buyer_organization_id, r.supplier_organization_id], action: "relationship_terms.updated", resourceType: "relationship_terms", resourceId: r.id, changes: changes as Prisma.InputJsonValue });
    }
    return after;
  });
  return NextResponse.json(updated);
});
