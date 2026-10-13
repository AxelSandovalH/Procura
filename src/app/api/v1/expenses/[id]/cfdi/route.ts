import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { linkCfdi } from "@/lib/finance/ops";
import { materializeReceived } from "@/lib/billing/cfdi-docs";
import { expenseView } from "@/lib/billing/expenses";
import { assertFeature } from "@/lib/billing/entitlements";

const Body = z.object({ cfdi_id: z.uuid(), amount_minor: z.number().int().positive().optional() });

/** Liga un CFDI recibido al gasto (importe documentado opcional; por defecto lo que cabe en ambos lados). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage"); authorize(actor, "cfdi.manage");
  await assertFeature(actor.organizationId, "cfdi");
  const body = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await materializeReceived(tx, actor.organizationId, actor.membershipId);
    const { link, cfdi } = await linkCfdi(tx, actor.organizationId, actor.membershipId, "expense", params.id, body.cfdi_id, body.amount_minor);
    const e = await tx.expenses.findUniqueOrThrow({ where: { id: params.id } });
    await audit(tx, { ...auditBase(actor), action: "cfdi.linked", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { link_id: link.id, cfdi_id: cfdi.id, fiscal_uuid: cfdi.fiscal_uuid, amount_minor: link.amount_minor.toString() } });
    return expenseView(tx, e);
  });
  return NextResponse.json(out, { status: 201 });
});
