import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

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
    await tx.expense_invoices.deleteMany({ where: { expense_id: e.id } });
    const updated = await tx.expenses.update({ where: { id: e.id }, data: { voided_at: new Date(), void_reason: reason, updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "expense.voided", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, reason });
    return updated;
  });
  return NextResponse.json(out);
});
