import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { expenseWithInvoices, loadLinkableInvoices } from "@/lib/billing/expenses";

const Body = z.object({ supplier_invoice_id: z.uuid() });

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  const { supplier_invoice_id } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!e) throw Problem.notFound();
    if (e.voided_at) throw Problem.conflict("El gasto está anulado");
    const [inv] = await loadLinkableInvoices(tx, actor, [supplier_invoice_id]);
    await tx.expense_invoices.upsert({ where: { expense_id_supplier_invoice_id: { expense_id: e.id, supplier_invoice_id } }, update: {}, create: { expense_id: e.id, supplier_invoice_id, organization_id: actor.organizationId } });
    await audit(tx, { ...auditBase(actor), action: "expense.invoice_linked", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { invoice_id: inv!.id, fiscal_uuid: inv!.fiscal_uuid } });
    return expenseWithInvoices(tx, e);
  });
  return NextResponse.json(out, { status: 201 });
});
