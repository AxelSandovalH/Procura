import type { Tx } from "@/lib/db/client";
import { Prisma } from "@prisma/client";

/** Libro de créditos de timbrado: solo se agregan movimientos; el saldo es su suma. Cada compra y cada consumo se identifican por su referencia, así que repetirlos no duplica nada. */
export async function creditBalance(tx: Tx, organizationId: string): Promise<number> {
  const a = await tx.stamp_credit_ledger.aggregate({ where: { organization_id: organizationId }, _sum: { delta: true } });
  return a._sum.delta ?? 0;
}
export async function creditsRequired(tx: Tx, organizationId: string): Promise<boolean> {
  return !!(await tx.organization_subscriptions.findUnique({ where: { organization_id: organizationId }, select: { credits_required: true } }))?.credits_required;
}
/** Saldo disponible = saldo − emisiones en curso (cada una consumirá un crédito si el timbrado resulta exitoso). */
export async function availableCredits(tx: Tx, organizationId: string): Promise<number> {
  const pending = await tx.fiscal_issue_requests.count({ where: { organization_id: organizationId, status: "PENDING" } });
  return (await creditBalance(tx, organizationId)) - pending;
}
/** Agrega un movimiento. Devuelve false si ya existía (misma organización, tipo y referencia): la operación es idempotente. */
export async function addLedger(tx: Tx, organizationId: string, delta: number, kind: "PURCHASE" | "CONSUME" | "ADJUST", reference: string, note?: string): Promise<boolean> {
  try { await tx.$executeRaw`savepoint ledger_add`; await tx.stamp_credit_ledger.create({ data: { organization_id: organizationId, delta, kind, reference, note: note ?? null } }); await tx.$executeRaw`release savepoint ledger_add`; return true; }
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { await tx.$executeRaw`rollback to savepoint ledger_add`; return false; }
    throw e;
  }
}
