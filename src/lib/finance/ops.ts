import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";
import { audit } from "@/lib/audit";
import { assertAllocation, defaultAllocation, retainedShare } from "@/lib/finance/calc";

export type OpKind = "sale" | "expense";

/** Recalcula la caché de importes (cobrado/pagado, documentado) de una venta o gasto y la del CFDI. Llamar en la misma transacción. */
/** Importe documentado por CFDI: los comprobantes cancelados ante el SAT ya no documentan nada (el vínculo se conserva como historial). */
async function documentedMinor(tx: Tx, where: { sale_id: string } | { expense_id: string }): Promise<{ documented: bigint; withheld: bigint }> {
  const links = await tx.cfdi_links.findMany({ where, select: { cfdi_id: true, amount_minor: true } });
  if (links.length === 0) return { documented: BigInt(0), withheld: BigInt(0) };
  const docs = new Map((await tx.cfdi_documents.findMany({ where: { id: { in: links.map((l) => l.cfdi_id) }, sat_status: { not: "CANCELADO" } }, select: { id: true, total_minor: true, retained_minor: true } })).map((d) => [d.id, d]));
  let documented = BigInt(0), withheld = BigInt(0);
  for (const l of links) {
    const d = docs.get(l.cfdi_id); if (!d) continue; // CFDI cancelado: ya no documenta
    documented += l.amount_minor;
    withheld += retainedShare(l.amount_minor, d.total_minor, d.retained_minor);
  }
  return { documented, withheld };
}
export async function recomputeSale(tx: Tx, id: string) {
  const [pay, doc] = await Promise.all([
    tx.payments.aggregate({ where: { sale_id: id, voided_at: null }, _sum: { amount_minor: true } }),
    documentedMinor(tx, { sale_id: id }),
  ]);
  return tx.sales.update({ where: { id }, data: { collected_minor: pay._sum.amount_minor ?? BigInt(0), documented_minor: doc.documented, withheld_minor: doc.withheld, updated_at: new Date() } });
}
export async function recomputeExpense(tx: Tx, id: string) {
  const [pay, doc] = await Promise.all([
    tx.payments.aggregate({ where: { expense_id: id, voided_at: null }, _sum: { amount_minor: true } }),
    documentedMinor(tx, { expense_id: id }),
  ]);
  return tx.expenses.update({ where: { id }, data: { paid_minor: pay._sum.amount_minor ?? BigInt(0), documented_minor: doc.documented, updated_at: new Date() } });
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
  if (cfdi.sat_status === "CANCELADO" || cfdi.sat_status === "CANCELANDO") throw Problem.badRequest("El CFDI está cancelado (o en proceso de cancelación) ante el SAT: no puede documentar una operación");
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

  // Lo que un CFDI puede documentar es su total NETO más lo retenido (subtotal + IVA trasladado).
  const capacity = Number(cfdi.total_minor + cfdi.retained_minor);
  const amount = requestedAmount ?? defaultAllocation(Number(total), Number(documented), capacity, Number(cfdi.allocated_minor));
  assertAllocation(amount, Number(total), Number(documented), capacity, Number(cfdi.allocated_minor));
  const link = await tx.cfdi_links.create({ data: { organization_id: organizationId, cfdi_id: cfdi.id, ...(kind === "sale" ? { sale_id: opId } : { expense_id: opId }), amount_minor: BigInt(amount), created_by_membership_id: membershipId } });
  await recomputeCfdi(tx, cfdi.id);
  if (kind === "sale") await recomputeSale(tx, opId); else { await recomputeExpense(tx, opId); await autoPayFromXml(tx, organizationId, membershipId, opId); }
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
  // Lo que el cliente retiene (RESICO…) no se le cobra: se cobra total − retenido.
  const total = kind === "sale" ? (op as { total_minor: bigint; withheld_minor: bigint }).total_minor - (op as { withheld_minor: bigint }).withheld_minor : (op as { amount_minor: bigint }).amount_minor;
  const settled = kind === "sale" ? (op as { collected_minor: bigint }).collected_minor : (op as { paid_minor: bigint }).paid_minor;
  if (BigInt(input.amount_minor) > total - settled) throw Problem.badRequest(`El importe excede lo pendiente (${Number(total - settled) / 100}).`);
  const payment = await tx.payments.create({ data: {
    organization_id: organizationId, direction: kind === "sale" ? "IN" : "OUT", ...(kind === "sale" ? { sale_id: opId } : { expense_id: opId }),
    paid_at: input.paid_at, amount_minor: BigInt(input.amount_minor), currency: op.currency, method: input.method, external_reference: input.external_reference, notes: input.notes, created_by_membership_id: membershipId,
  } });
  const updated = kind === "sale" ? await recomputeSale(tx, opId) : await recomputeExpense(tx, opId);
  return { payment, operation: updated };
}

const FORM_TO_METHOD: Record<string, string> = { "01": "CASH", "03": "TRANSFER", "04": "CARD", "28": "CARD" };

/**
 * Regla opcional de la organización («gasto con XML = pagado»): registra el pago de lo documentado que aún no esté pagado, con la fecha del
 * gasto y la forma de pago del propio CFDI cuando la trae. Es un pago normal (se puede anular); desligar el XML no lo revierte.
 */
export async function autoPayFromXml(tx: Tx, organizationId: string, membershipId: string | null, expenseId: string): Promise<boolean> {
  const settings = await tx.organization_settings.findUnique({ where: { organization_id: organizationId }, select: { expenses_paid_when_xml: true } });
  if (!settings?.expenses_paid_when_xml) return false;
  const e = await tx.expenses.findFirst({ where: { id: expenseId, organization_id: organizationId } });
  if (!e || e.voided_at) return false;
  // Con XML ligado se paga lo documentado; una factura en PDF con folio fiscal (el XML aún no llega) cuenta como el gasto completo.
  const target = e.documented_minor > BigInt(0) ? (e.documented_minor < e.amount_minor ? e.documented_minor : e.amount_minor) : e.cfdi_uuid_hint ? e.amount_minor : BigInt(0);
  const owed = target - e.paid_minor;
  if (owed <= BigInt(0)) return false;
  const link = await tx.cfdi_links.findFirst({ where: { expense_id: e.id }, orderBy: { created_at: "asc" } });
  const cfdi = link ? await tx.cfdi_documents.findUnique({ where: { id: link.cfdi_id }, select: { fiscal_payment_form: true } }) : null;
  const method = (cfdi?.fiscal_payment_form && FORM_TO_METHOD[cfdi.fiscal_payment_form]) || undefined;
  const { payment } = await addPayment(tx, organizationId, membershipId, "expense", e.id, { paid_at: e.spent_at, amount_minor: Number(owed), method, notes: e.documented_minor > BigInt(0) ? "Pagado por regla: el gasto tiene XML ligado" : "Pagado por regla: el gasto tiene su factura (CFDI) en PDF" });
  await audit(tx, { actorType: membershipId ? "USER" : "SYSTEM", membershipId, organizationId, action: "payment.created", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { payment_id: payment.id, amount_minor: owed.toString(), auto: "expenses_paid_when_xml" } });
  return true;
}

/**
 * Una factura en PDF dejó su folio fiscal en el gasto. Cuando el CFDI (XML) ya existe o llega después, se liga solo.
 * Un fallo de validación (moneda distinta, importe que no cabe…) no interrumpe la carga del CFDI: el gasto simplemente sigue esperando el XML.
 */
export async function linkExpenseByUuid(tx: Tx, organizationId: string, membershipId: string | null, expenseId: string, uuid: string): Promise<boolean> {
  const cfdi = await tx.cfdi_documents.findFirst({ where: { organization_id: organizationId, direction: "RECEIVED", fiscal_uuid: { equals: uuid, mode: "insensitive" } }, select: { id: true } });
  if (!cfdi) return false;
  try { await linkCfdi(tx, organizationId, membershipId, "expense", expenseId, cfdi.id); return true; } catch (e) { if (e instanceof Problem) return false; throw e; }
}
export async function linkWaitingExpenses(tx: Tx, organizationId: string, membershipId: string | null, uuid: string): Promise<number> {
  const waiting = await tx.expenses.findMany({ where: { organization_id: organizationId, voided_at: null, cfdi_uuid_hint: { equals: uuid, mode: "insensitive" } }, select: { id: true } });
  let n = 0;
  for (const e of waiting) if (await linkExpenseByUuid(tx, organizationId, membershipId, e.id, uuid)) n++;
  return n;
}
