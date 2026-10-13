import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { unlinkCfdi } from "@/lib/finance/ops";
import { expenseView } from "@/lib/billing/expenses";

const Body = z.object({ reason: z.string().trim().min(1).max(300) });

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage"); authorize(actor, "cfdi.manage");
  const { reason } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const link = await unlinkCfdi(tx, actor.organizationId, "expense", params.id, params.lid);
    const e = await tx.expenses.findUniqueOrThrow({ where: { id: params.id } });
    await audit(tx, { ...auditBase(actor), action: "cfdi.unlinked", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, reason, metadata: { cfdi_id: link.cfdi_id, amount_minor: link.amount_minor.toString() } });
    return expenseView(tx, e);
  });
  return NextResponse.json(out);
});
