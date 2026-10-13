import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";
import { assertAllocation, defaultAllocation } from "@/lib/finance/calc";

export type OpKind = "sale" | "expense";

/** Recalcula la caché de importes (cobrado/pagado, documentado) de una venta o gasto y la del CFDI. Llamar en la misma transacción. */
export async function recomputeSale(tx: Tx, id: string) {
  const [pay, doc] = await Promise.all([
    tx.payments.aggregate({ where: { sale_id: id, voided_at: null }, _sum: { amount_minor: true } }),
    tx.cfdi_links.aggregate({ where: { sale_id: id }, _sum: { amount_minor: true } }),
  ]);
  return tx.sales.update({ where: { id }, data: { collected_minor: pay._sum.amount_minor ?? BigInt(0), documented_minor: doc._sum.amount_minor ?? BigInt(0), updated_at: new Date() } });
}
export async function recomputeExpense(tx: Tx, id: string) {
  const [pay, doc] = await Promise.all([
    tx.payments.aggregate({ where: { expense_id: id, voided_at: null }, _sum: { amount_minor: true } }),
    tx.cfdi_links.aggregate({ where: { expense_id: id }, _sum: { amount_minor: true } }),
  ]);
  return tx.expenses.update({ where: { id }, data: { paid_minor: pay._sum.amount_minor ?? BigInt(0), documented_minor: doc._sum.amount_minor ?? BigInt(0), updated_at: new Date() } });
}
export async function recomputeCfdi(tx: Tx, id: string) {
  const agg = await tx.cfdi_links.aggregate({ where: { cfdi_id: id }, _sum: { amount_minor: true } });
  return tx.cfdi_documents.update({ where: { id }, data: { allocated_minor: agg._sum.amount_minor ?? BigInt(0), updated_at: new Date() } });
}

/** Liga un CFDI a una venta o gasto (validando organización, moneda, vigencia, duplicados e importes). */
export async function linkCfdi(tx: Tx, organizationId: string, membershipId: string | null, kind: OpKind, opId: string, cfdiId: string, requestedAmount?: number) {
  const cfdi = await tx.cfdi_documents.findFirst({ where: { id: cfdiId, organization_id: organizationId } });
  if (!cfdi) throw Problem.badRequest("El CFDI no existe o no es de tu organización");
  if (cfdi.cfdi_type !== "I") throw Problem.badRequest("Solo un CFDI de ingreso (tipo I) puede documentar una venta o un gasto");
  if (cfdi.sat_status === "CANCELADO") throw Problem.badRequest("El CFDI está cancelado ante el SAT: no puede documentar una operación");
  const op = kind === "sale"
    ? await tx.sales.findFirst({ where: { id: opId, organization_id: organizationId } })
    : await tx.expenses.findFirst({ where: { id: opId, organization_id: organizationId } });
  if (!op) throw Problem.notFound();
  if (op.voided_at) throw Problem.conflict("La operación está anulada");
  const [total, documented] = kind === "sale" ? [(op as { total_minor: bigint }).total_minor, op.documented_minor] : [(op as { amount_minor: bigint }).amount_minor, op.documented_minor];
  if (cfdi.currency !== op.currency) throw Problem.badRequest(`El CFDI está en ${cfdi.currency} y la operación en ${op.currency}`);
  // Una venta se documenta con CFDI emitidos; un gasto, con recibidos.
  if (kind === "sale" && cfdi.direction !== "ISSUED") throw Problem.badRequest("Una venta se documenta con un CFDI emitido");
  if (kind === "expense" && cfdi.direction !== "RECEIVED") throw Problem.badRequest("Un gasto se documenta con un CFDI recibido");

  const existing = await tx.cfdi_links.findFirst({ where: { cfdi_id: cfdi.id, ...(kind === "sale" ? { sale_id: opId } : { expense_id: opId }) }, select: { id: true } });
  if (existing) throw Problem.conflict("Ese CFDI ya está ligado a esta operación");

  const amount = requestedAmount ?? defaultAllocation(Number(total), Number(documented), Number(cfdi.total_minor), Number(cfdi.allocated_minor));
  assertAllocation(amount, Number(total), Number(documented), Number(cfdi.total_minor), Number(cfdi.allocated_minor));
  const link = await tx.cfdi_links.create({ data: { organization_id: organizationId, cfdi_id: cfdi.id, ...(kind === "sale" ? { sale_id: opId } : { expense_id: opId }), amount_minor: BigInt(amount), created_by_membership_id: membershipId } });
  await recomputeCfdi(tx, cfdi.id);
  if (kind === "sale") await recomputeSale(tx, opId); else await recomputeExpense(tx, opId);
  return { link, cfdi };
}

export async function unlinkCfdi(tx: Tx, organizationId: string, kind: OpKind, opId: string, linkId: string) {
  const link = await tx.cfdi_links.findFirst({ where: { id: linkId, organization_id: organizationId, ...(kind === "sale" ? { sale_id: opId } : { expense_id: opId }) } });
  if (!link) throw Problem.notFound("La vinculación no existe");
  await tx.cfdi_links.delete({ where: { id: link.id } });
  await recomputeCfdi(tx, link.cfdi_id);
  if (kind === "sale") await recomputeSale(tx, opId); else await recomputeExpense(tx, opId);
  return link;
}

/** Registra un cobro (venta) o pago (gasto) parcial o total sin exceder el importe de la operación. */
export async function addPayment(tx: Tx, organizationId: string, membershipId: string | null, kind: OpKind, opId: string, input: { paid_at: Date; amount_minor: number; method?: string; external_reference?: string; notes?: string }) {
  const op = kind === "sale"
    ? await tx.sales.findFirst({ where: { id: opId, organization_id: organizationId } })
    : await tx.expenses.findFirst({ where: { id: opId, organization_id: organizationId } });
  if (!op) throw Problem.notFound();
  if (op.voided_at) throw Problem.conflict("La operación está anulada");
  const total = kind === "sale" ? (op as { total_minor: bigint }).total_minor : (op as { amount_minor: bigint }).amount_minor;
  const settled = kind === "sale" ? (op as { collected_minor: bigint }).collected_minor : (op as { paid_minor: bigint }).paid_minor;
  if (BigInt(input.amount_minor) > total - settled) throw Problem.badRequest(`El importe excede lo pendiente (${Number(total - settled) / 100}).`);
  const payment = await tx.payments.create({ data: {
    organization_id: organizationId, direction: kind === "sale" ? "IN" : "OUT", ...(kind === "sale" ? { sale_id: opId } : { expense_id: opId }),
    paid_at: input.paid_at, amount_minor: BigInt(input.amount_minor), currency: op.currency, method: input.method, external_reference: input.external_reference, notes: input.notes, created_by_membership_id: membershipId,
  } });
  const updated = kind === "sale" ? await recomputeSale(tx, opId) : await recomputeExpense(tx, opId);
  return { payment, operation: updated };
}
