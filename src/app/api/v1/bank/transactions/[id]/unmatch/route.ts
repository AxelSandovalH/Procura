import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
/** Deshace la conciliación. El pago registrado se conserva (se anula desde el gasto o la venta si hace falta). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const t = await tx.bank_transactions.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!t) throw Problem.notFound("El movimiento no existe");
    if (t.status !== "MATCHED") throw Problem.conflict("El movimiento no está conciliado.");
    await tx.bank_transactions.update({ where: { id: t.id }, data: { status: "UNMATCHED", payment_id: null, matched_at: null } });
    await audit(tx, { ...auditBase(actor), action: "bank_transaction.unmatched", resourceType: "bank_transaction", resourceId: t.id, resourceLabel: t.description, metadata: { payment_id: t.payment_id } });
  });
  return NextResponse.json({ ok: true });
});
