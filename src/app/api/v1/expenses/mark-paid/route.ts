import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { addPayment } from "@/lib/finance/ops";

const Body = z.object({ expense_ids: z.array(z.uuid()).min(1).max(100), method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional() });

/**
 * Marca varios gastos como pagados: registra el pago de lo que falta de cada uno con la fecha del propio gasto. Cada gasto es independiente
 * (anulados y ya pagados se omiten) y todo queda auditado como pagos normales, que se pueden anular uno por uno.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage"); authorize(actor, "expense.manage");
  const body = await json(req, (d) => Body.parse(d));
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const results: { expense_id: string; status: "PAID" | "SKIPPED" | "ERROR"; message?: string }[] = [];
  for (const id of [...new Set(body.expense_ids)]) {
    try {
      const out = await withContext(ctx, async (tx) => {
        const e = await tx.expenses.findFirst({ where: { id, organization_id: actor.organizationId } });
        if (!e) throw Problem.notFound("El gasto no existe en tu organización");
        if (e.voided_at) return "Está anulado" as const;
        const pending = e.amount_minor - e.paid_minor;
        if (pending <= BigInt(0)) return "Ya está pagado" as const;
        const p = await addPayment(tx, actor.organizationId, actor.membershipId, "expense", e.id, { paid_at: e.spent_at, amount_minor: Number(pending), method: body.method });
        await audit(tx, { ...auditBase(actor), action: "payment.created", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { payment_id: p.payment.id, amount_minor: pending.toString(), method: body.method, bulk: true } });
        return null;
      });
      results.push(out ? { expense_id: id, status: "SKIPPED", message: out } : { expense_id: id, status: "PAID" });
    } catch (e) { results.push({ expense_id: id, status: "ERROR", message: e instanceof Problem ? (e.detail ?? e.title) : "Error inesperado." }); }
  }
  const n = (s: string) => results.filter((r) => r.status === s).length;
  return NextResponse.json({ summary: { paid: n("PAID"), skipped: n("SKIPPED"), errors: n("ERROR") }, results });
});
