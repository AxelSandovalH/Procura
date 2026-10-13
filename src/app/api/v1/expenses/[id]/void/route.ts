import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { recomputeCfdi } from "@/lib/finance/ops";

const Body = z.object({ reason: z.string().trim().min(1).max(300) });

/** Nada se borra: el gasto se anula con motivo y sus facturas quedan liberadas. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  const { reason } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!e) throw Problem.notFound();
    if (e.voided_at) throw Problem.conflict("El gasto ya está anulado");
    if (e.paid_minor > BigInt(0)) throw Problem.conflict("El gasto tiene pagos vigentes; anúlalos antes de anular el gasto.");
    const links = await tx.cfdi_links.findMany({ where: { expense_id: e.id }, select: { cfdi_id: true } });
    await tx.cfdi_links.deleteMany({ where: { expense_id: e.id } });
    for (const l of links) await recomputeCfdi(tx, l.cfdi_id);
    const updated = await tx.expenses.update({ where: { id: e.id }, data: { voided_at: new Date(), void_reason: reason, documented_minor: BigInt(0), updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "expense.voided", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, reason });
    return updated;
  });
  return NextResponse.json(out);
});
