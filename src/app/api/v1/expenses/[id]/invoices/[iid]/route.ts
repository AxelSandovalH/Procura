import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { expenseWithInvoices } from "@/lib/billing/expenses";

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!e) throw Problem.notFound();
    const del = await tx.expense_invoices.deleteMany({ where: { expense_id: e.id, supplier_invoice_id: params.iid } });
    if (del.count === 0) throw Problem.notFound("La factura no está ligada a este gasto");
    await audit(tx, { ...auditBase(actor), action: "expense.invoice_unlinked", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { invoice_id: params.iid } });
    return expenseWithInvoices(tx, e);
  });
  return NextResponse.json(out);
});
