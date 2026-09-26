import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { isoDate } from "@/lib/validation";

const Body = z.object({ valid_until: isoDate });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const { valid_until } = await json(req, (d) => Body.parse(d));
  const quotation = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const q = await tx.quotations.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
    if (!q) throw Problem.notFound();
    if (!actor.permissions.has("quotation.submit")) throw Problem.forbidden();
    if (q.status !== "SUBMITTED" && q.status !== "EXPIRED") throw Problem.conflict(`No se puede extender en estado ${q.status}`);
    if (new Date(valid_until) < new Date(new Date().toDateString())) throw Problem.badRequest("La nueva fecha no puede estar en el pasado");
    const updated = await tx.quotations.update({ where: { id: q.id }, data: { valid_until, status: "SUBMITTED" } });
    await audit(tx, { ...auditBase(actor), visibleTo: [q.buyer_organization_id, q.supplier_organization_id], action: "quotation.extended", resourceType: "quotation", resourceId: q.id, resourceLabel: q.quotation_number, metadata: { valid_until } });
    return updated;
  });
  return NextResponse.json(quotation);
});
