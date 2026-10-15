import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";
import { audit } from "@/lib/audit";
import { addPayment } from "@/lib/finance/ops";
import { assertExpensesManagedHere } from "@/lib/billing/expenses";
import type { Candidate } from "@/lib/bank/match";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Lo que un movimiento podría estar pagando: gastos/ventas con saldo pendiente y pagos/cobros ya registrados que aún no tienen movimiento bancario. */
export async function loadCandidates(tx: Tx, organizationId: string, currency: string, outflow: boolean): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (outflow) {
    for (const e of await tx.expenses.findMany({ where: { organization_id: organizationId, voided_at: null, currency }, orderBy: { spent_at: "desc" }, take: 500 })) {
      const pending = Number(e.amount_minor - e.paid_minor);
      if (pending > 0) out.push({ kind: "expense", id: e.id, label: e.description, date: iso(e.spent_at), amount_minor: pending, counterparty: e.supplier_name });
    }
  } else {
    const customers = new Map((await tx.customers.findMany({ where: { organization_id: organizationId }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    for (const s of await tx.sales.findMany({ where: { organization_id: organizationId, voided_at: null, currency }, orderBy: { sold_at: "desc" }, take: 500 })) {
      const pending = Number(s.total_minor - s.withheld_minor - s.collected_minor);
      if (pending > 0) out.push({ kind: "sale", id: s.id, label: `${s.folio} · ${s.description}`, date: iso(s.sold_at), amount_minor: pending, counterparty: s.customer_id ? customers.get(s.customer_id) ?? null : null });
    }
  }
  const linked = new Set((await tx.bank_transactions.findMany({ where: { organization_id: organizationId, payment_id: { not: null } }, select: { payment_id: true } })).map((x) => x.payment_id!));
  const pays = (await tx.payments.findMany({ where: { organization_id: organizationId, voided_at: null, currency, direction: outflow ? "OUT" : "IN" }, orderBy: { paid_at: "desc" }, take: 500 })).filter((p) => !linked.has(p.id));
  const exp = new Map((await tx.expenses.findMany({ where: { id: { in: pays.map((p) => p.expense_id).filter((x): x is string => !!x) } }, select: { id: true, description: true, supplier_name: true } })).map((e) => [e.id, e]));
  const sal = new Map((await tx.sales.findMany({ where: { id: { in: pays.map((p) => p.sale_id).filter((x): x is string => !!x) } }, select: { id: true, folio: true, description: true } })).map((s) => [s.id, s]));
  for (const p of pays) {
    const e = p.expense_id ? exp.get(p.expense_id) : undefined, s = p.sale_id ? sal.get(p.sale_id) : undefined;
    out.push({ kind: "payment", id: p.id, payment_id: p.id, label: `${outflow ? "Pago registrado" : "Cobro registrado"}: ${e?.description ?? (s ? `${s.folio} · ${s.description}` : "—")}`, date: iso(p.paid_at), amount_minor: Number(p.amount_minor), counterparty: e?.supplier_name ?? null });
  }
  return out;
}

/** Gastos pendientes en una moneda distinta a la de la cuenta (p. ej. USD pagados con una tarjeta en pesos). */
export async function loadForeignExpenses(tx: Tx, organizationId: string, accountCurrency: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const e of await tx.expenses.findMany({ where: { organization_id: organizationId, voided_at: null, currency: { not: accountCurrency } }, orderBy: { spent_at: "desc" }, take: 300 })) {
    const pending = Number(e.amount_minor - e.paid_minor);
    if (pending > 0) out.push({ kind: "expense", id: e.id, label: e.description, date: iso(e.spent_at), amount_minor: pending, counterparty: e.supplier_name, currency: e.currency });
  }
  // Gastos en otra moneda que ya se marcaron como pagados: falta confirmar su pago contra el cargo del banco.
  const linked = new Set((await tx.bank_transactions.findMany({ where: { organization_id: organizationId, payment_id: { not: null } }, select: { payment_id: true } })).map((x) => x.payment_id!));
  const pays = (await tx.payments.findMany({ where: { organization_id: organizationId, voided_at: null, direction: "OUT", currency: { not: accountCurrency } }, orderBy: { paid_at: "desc" }, take: 300 })).filter((p) => !linked.has(p.id));
  const exp = new Map((await tx.expenses.findMany({ where: { id: { in: pays.map((p) => p.expense_id).filter((x): x is string => !!x) } }, select: { id: true, description: true, supplier_name: true, spent_at: true } })).map((e) => [e.id, e]));
  for (const p of pays) {
    const e = p.expense_id ? exp.get(p.expense_id) : undefined;
    out.push({ kind: "payment", id: p.id, payment_id: p.id, label: `Pago registrado: ${e?.description ?? "—"}`, date: iso(e?.spent_at ?? p.paid_at), amount_minor: Number(p.amount_minor), counterparty: e?.supplier_name ?? null, currency: p.currency });
  }
  return out;
}

async function openTxn(tx: Tx, organizationId: string, id: string) {
  const t = await tx.bank_transactions.findFirst({ where: { id, organization_id: organizationId } });
  if (!t) throw Problem.notFound("El movimiento no existe");
  if (t.status !== "UNMATCHED") throw Problem.conflict(t.status === "MATCHED" ? "Este movimiento ya está conciliado." : "Este movimiento está ignorado: devuélvelo a «por conciliar» primero.");
  const acct = await tx.bank_accounts.findUniqueOrThrow({ where: { id: t.bank_account_id } });
  return { t, acct, abs: t.amount_minor < BigInt(0) ? -t.amount_minor : t.amount_minor, outflow: t.amount_minor < BigInt(0) };
}

async function link(tx: Tx, organizationId: string, membershipId: string | null, txnId: string, paymentId: string, how: string, label: string) {
  const row = await tx.bank_transactions.update({ where: { id: txnId }, data: { status: "MATCHED", payment_id: paymentId, matched_at: new Date() } });
  await audit(tx, { actorType: "USER", membershipId, organizationId, action: "bank_transaction.reconciled", resourceType: "bank_transaction", resourceId: txnId, resourceLabel: label, metadata: { payment_id: paymentId, how } });
  return row;
}

/** Concilia con un pago ya registrado (se confirma contra el banco y toma la fecha del banco), o registra el pago en un gasto/venta con saldo pendiente. */
export async function reconcile(tx: Tx, organizationId: string, membershipId: string | null, txnId: string, target: { payment_id?: string; expense_id?: string; sale_id?: string }) {
  const { t, acct, abs, outflow } = await openTxn(tx, organizationId, txnId);
  if (target.payment_id) {
    const p = await tx.payments.findFirst({ where: { id: target.payment_id, organization_id: organizationId, voided_at: null } });
    if (!p) throw Problem.notFound("El pago no existe o está anulado");
    if ((p.direction === "OUT") !== outflow) throw Problem.badRequest(outflow ? "Un cargo solo concilia con un pago, no con un cobro." : "Un abono solo concilia con un cobro, no con un pago.");
    const foreign = p.currency !== acct.currency; // pago en otra moneda (p. ej. USD) contra un cargo en pesos: el importe lo fija el tipo de cambio del banco
    if (foreign && !outflow) throw Problem.badRequest("Solo un cargo puede conciliarse con un pago en otra moneda.");
    if (!foreign && p.amount_minor !== abs) throw Problem.badRequest("El importe del pago no coincide con el del movimiento.");
    if (await tx.bank_transactions.findFirst({ where: { payment_id: p.id }, select: { id: true } })) throw Problem.conflict("Ese pago ya está conciliado con otro movimiento.");
    const fxNote = foreign ? `Conciliado con el banco: cargo de ${(Number(abs) / 100).toFixed(2)} ${acct.currency} (tipo de cambio implícito ${(Number(abs) / Number(p.amount_minor)).toFixed(4)}).` : null;
    await tx.payments.update({ where: { id: p.id }, data: { paid_at: t.posted_at, ...(fxNote ? { notes: [p.notes, fxNote].filter(Boolean).join(" ").slice(0, 500) } : {}) } });
    return link(tx, organizationId, membershipId, t.id, p.id, foreign ? "foreign_payment" : "existing_payment", t.description);
  }
  const kind = target.expense_id ? "expense" : target.sale_id ? "sale" : null;
  if (!kind) throw Problem.badRequest("Indica el pago, gasto o venta con el que se concilia.");
  if ((kind === "expense") !== outflow) throw Problem.badRequest(outflow ? "Un cargo se concilia con un gasto." : "Un abono se concilia con una venta.");
  // Un gasto en otra moneda (p. ej. USD) se liquida completo: el pago queda en la moneda del gasto y la nota guarda lo que cargó el banco y el tipo de cambio implícito.
  if (kind === "expense") {
    const e = await tx.expenses.findFirst({ where: { id: target.expense_id!, organization_id: organizationId, voided_at: null } });
    if (e && e.currency !== acct.currency) {
      const pending = e.amount_minor - e.paid_minor;
      if (pending <= BigInt(0)) throw Problem.conflict("Ese gasto ya está pagado.");
      const rate = Number(abs) / Number(pending);
      const note = `Conciliado con el banco: cargo de ${(Number(abs) / 100).toFixed(2)} ${acct.currency} (tipo de cambio implícito ${rate.toFixed(4)}). ${t.description}`.slice(0, 300);
      const { payment } = await addPayment(tx, organizationId, membershipId, "expense", e.id, { paid_at: t.posted_at, amount_minor: Number(pending), notes: note });
      return link(tx, organizationId, membershipId, t.id, payment.id, "foreign_expense", t.description);
    }
  }
  const { payment } = await addPayment(tx, organizationId, membershipId, kind, (target.expense_id ?? target.sale_id)!, { paid_at: t.posted_at, amount_minor: Number(abs), notes: `Conciliado con el banco: ${t.description}`.slice(0, 300) });
  return link(tx, organizationId, membershipId, t.id, payment.id, kind, t.description);
}

/** Un cargo sin ticket: crea el gasto (ya pagado) a partir del movimiento y lo concilia. */
export async function expenseFromCharge(tx: Tx, organizationId: string, membershipId: string | null, txnId: string, input: { description: string; category?: string | null; supplier_name?: string | null }) {
  const { t, acct, abs, outflow } = await openTxn(tx, organizationId, txnId);
  if (!outflow) throw Problem.badRequest("Solo un cargo puede convertirse en gasto.");
  await assertExpensesManagedHere(tx, organizationId);
  const e = await tx.expenses.create({ data: { organization_id: organizationId, spent_at: t.posted_at, description: input.description, category: input.category ?? null, supplier_name: input.supplier_name ?? null, amount_minor: abs, currency: acct.currency, source: "MANUAL", created_by_membership_id: membershipId } });
  const { payment } = await addPayment(tx, organizationId, membershipId, "expense", e.id, { paid_at: t.posted_at, amount_minor: Number(abs), notes: `Conciliado con el banco: ${t.description}`.slice(0, 300) });
  await link(tx, organizationId, membershipId, t.id, payment.id, "new_expense", t.description);
  return e;
}
