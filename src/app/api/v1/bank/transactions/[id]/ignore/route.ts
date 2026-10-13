import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { assertFeature } from "@/lib/billing/entitlements";
const Body = z.object({ ignored: z.boolean().default(true) });

/** Ignora un movimiento (traspaso propio, comisión ya conocida…) o lo devuelve a «por conciliar». */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  await assertFeature(actor.organizationId, "bank");
  const { ignored } = await json(req, (d) => Body.parse(d));
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const t = await tx.bank_transactions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!t) throw Problem.notFound("El movimiento no existe");
    if (t.status === "MATCHED") throw Problem.conflict("Está conciliado: primero deshaz la conciliación.");
    await tx.bank_transactions.update({ where: { id: t.id }, data: { status: ignored ? "IGNORED" : "UNMATCHED" } });
    await audit(tx, { ...auditBase(actor), action: ignored ? "bank_transaction.ignored" : "bank_transaction.restored", resourceType: "bank_transaction", resourceId: t.id, resourceLabel: t.description });
  });
  return NextResponse.json({ ok: true });
});
