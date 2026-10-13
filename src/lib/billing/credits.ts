import type { Tx } from "@/lib/db/client";
import { Prisma } from "@prisma/client";
import { notifyPermissionHolders } from "@/lib/events/emit";

/** Con este saldo (o menos) se avisa que quedan pocos créditos de timbrado. */
export const LOW_CREDITS_THRESHOLD = 10;
export type CreditLevel = "OK" | "LOW" | "EMPTY";
export const creditLevel = (available: number): CreditLevel => (available <= 0 ? "EMPTY" : available <= LOW_CREDITS_THRESHOLD ? "LOW" : "OK");

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

/**
 * Descuenta un crédito tras un timbrado exitoso (idempotente por referencia) y, SOLO al cruzar el umbral, avisa a quienes administran la organización
 * (campana y correo): una vez al quedar con pocos créditos y otra al quedar sin ninguno.
 */
export async function consumeCredit(tx: Tx, organizationId: string, reference: string, note: string): Promise<{ added: boolean; balance: number }> {
  const added = await addLedger(tx, organizationId, -1, "CONSUME", reference, note);
  const balance = await creditBalance(tx, organizationId);
  if (!added) return { added, balance };
  const before = creditLevel(balance + 1), after = creditLevel(balance);
  if (after !== before && after !== "OK") {
    await notifyPermissionHolders(tx, {
      organizationId, permission: "organization.update", type: after === "EMPTY" ? "billing.credits_empty" : "billing.credits_low", resourceType: "organization", resourceId: organizationId,
      title: after === "EMPTY" ? "Te quedaste sin créditos de timbrado" : `Te quedan ${balance} créditos de timbrado`,
      body: after === "EMPTY" ? "No podrás emitir facturas hasta recargar. Compra un paquete en Suscripción." : "Recarga pronto para no interrumpir tu facturación: compra un paquete en Suscripción.",
    });
  }
  return { added, balance };
}
