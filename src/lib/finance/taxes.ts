/**
 * Estimación mensual de impuestos de una persona física en RESICO (art. 113-E LISR y LIVA). Es una ESTIMACIÓN para planear: no sustituye a la contadora ni a la declaración.
 * - ISR: se paga sobre lo efectivamente COBRADO en el mes sin IVA; la tasa depende del ingreso del mes (tabla de abajo). En RESICO los gastos NO se deducen para el ISR.
 * - ISR retenido por clientes personas morales (1.25 %) se acredita contra el ISR del mes.
 * - IVA: trasladado cobrado − IVA acreditable de gastos PAGADOS en el mes con CFDI − IVA que te retuvieron. Se paga a más tardar el día 17 del mes siguiente.
 * - No acreditable: gastos sin CFDI (XML), pagados en efectivo por más de $2,000, cancelados, o en otra moneda (aquí solo se cuenta MXN).
 */
export const RESICO_BRACKETS: { upTo: number; rate: number }[] = [ // importes mensuales en centavos
  { upTo: 2_500_000, rate: 0.01 }, { upTo: 5_000_000, rate: 0.011 }, { upTo: 8_333_333, rate: 0.015 }, { upTo: 20_833_333, rate: 0.02 }, { upTo: 350_000_000, rate: 0.025 },
];
export const CASH_LIMIT_MINOR = 200_000;
export const RET_ISR_RATE = 0.0125;

export const isrRate = (monthlyIncomeMinor: number) => (RESICO_BRACKETS.find((b) => monthlyIncomeMinor <= b.upTo) ?? RESICO_BRACKETS[RESICO_BRACKETS.length - 1]!).rate;
/** Cuánto falta para pasar al siguiente tramo (y su tasa, que se aplica a TODO el ingreso del mes). null si ya está en el último. */
export function nextBracket(monthlyIncomeMinor: number) {
  const i = RESICO_BRACKETS.findIndex((b) => monthlyIncomeMinor <= b.upTo); const next = RESICO_BRACKETS[i + 1];
  return i >= 0 && next ? { atMinor: RESICO_BRACKETS[i]!.upTo + 1, rate: next.rate, remainingMinor: RESICO_BRACKETS[i]!.upTo - monthlyIncomeMinor + 1 } : null;
}
const round = (x: number) => Math.round(x + 1e-9);

export interface SalePaymentIn { saleId: string; folio: string; description: string; paidAt: string; amountMinor: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; withheldMinor: number }
export interface ExpensePaymentOut { expenseId: string; description: string; supplier: string | null; paidAt: string; amountMinor: number; expenseAmountMinor: number; method: string | null; ivaMinor: number; hasCfdi: boolean; pdfOnly: boolean }

export interface IncomeLine { saleId: string; folio: string; description: string; paidAt: string; firstPaidAt: string; payments: number; baseMinor: number; ivaMinor: number; isrWithheldMinor: number; ivaWithheldMinor: number }
export interface ExpenseLine { expenseId: string; description: string; supplier: string | null; paidAt: string; amountMinor: number; ivaCreditMinor: number; reason: "ACREDITABLE" | "SIN_XML" | "EFECTIVO" | "SIN_IVA"; note: string }
export interface MonthlyTaxes {
  income: { lines: IncomeLine[]; baseMinor: number };
  isr: { rate: number; causedMinor: number; withheldMinor: number; payableMinor: number; creditMinor: number; next: { atMinor: number; rate: number; remainingMinor: number } | null };
  iva: { collectedMinor: number; creditableMinor: number; withheldMinor: number; payableMinor: number; favorMinor: number };
  totalPayableMinor: number;
  expenses: { lines: ExpenseLine[]; creditableMinor: number; lostCashMinor: number; withoutXmlMinor: number };
}

/** Parte de una venta que se reconoce con un cobro: el cobro entre lo que el cliente debe pagar (total menos lo que retiene). */
function share(p: SalePaymentIn) { const net = p.totalMinor - p.withheldMinor; return net > 0 ? Math.min(1, p.amountMinor / net) : 0; }

/** Reparte lo retenido de una venta entre ISR (1.25 % del subtotal) e IVA retenido (el resto). */
export function splitWithheld(baseMinor: number, withheldMinor: number) { const isr = Math.min(withheldMinor, round(baseMinor * RET_ISR_RATE)); return { isr, iva: withheldMinor - isr }; }

export function computeMonthlyTaxes(sales: SalePaymentIn[], expenses: ExpensePaymentOut[]): MonthlyTaxes {
  // Una fila por venta: varios cobros de la misma venta en el mes se suman (la fecha es la del último cobro).
  const bySale = new Map<string, IncomeLine>();
  for (const p of [...sales].sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
    const f = share(p), fullBase = p.subtotalMinor - p.discountMinor, w = splitWithheld(fullBase, p.withheldMinor);
    const prev = bySale.get(p.saleId);
    bySale.set(p.saleId, { saleId: p.saleId, folio: p.folio, description: p.description, paidAt: p.paidAt, firstPaidAt: prev?.firstPaidAt ?? p.paidAt, payments: (prev?.payments ?? 0) + 1,
      baseMinor: (prev?.baseMinor ?? 0) + round(fullBase * f), ivaMinor: (prev?.ivaMinor ?? 0) + round(p.taxMinor * f), isrWithheldMinor: (prev?.isrWithheldMinor ?? 0) + round(w.isr * f), ivaWithheldMinor: (prev?.ivaWithheldMinor ?? 0) + round(w.iva * f) });
  }
  const lines = [...bySale.values()].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const baseMinor = lines.reduce((a, l) => a + l.baseMinor, 0);
  const rate = isrRate(baseMinor), caused = round(baseMinor * rate), isrWith = lines.reduce((a, l) => a + l.isrWithheldMinor, 0);
  const ivaCollected = lines.reduce((a, l) => a + l.ivaMinor, 0), ivaWith = lines.reduce((a, l) => a + l.ivaWithheldMinor, 0);

  let creditable = 0, lostCash = 0, withoutXml = 0;
  const eLines: ExpenseLine[] = expenses.map((e) => {
    const f = e.expenseAmountMinor > 0 ? Math.min(1, e.amountMinor / e.expenseAmountMinor) : 0, base = { expenseId: e.expenseId, description: e.description, supplier: e.supplier, paidAt: e.paidAt, amountMinor: e.amountMinor };
    if (!e.hasCfdi) { withoutXml += e.amountMinor; return { ...base, ivaCreditMinor: 0, reason: "SIN_XML" as const, note: e.pdfOnly ? "Tienes el PDF pero falta el XML: sin XML no se acredita el IVA." : "Sin CFDI (XML): no se acredita el IVA. Pide la factura." }; }
    const iva = round(e.ivaMinor * f);
    if (iva <= 0) return { ...base, ivaCreditMinor: 0, reason: "SIN_IVA" as const, note: "La factura no trae IVA trasladado." };
    if (e.method === "CASH" && e.amountMinor > CASH_LIMIT_MINOR) { lostCash += iva; return { ...base, ivaCreditMinor: 0, reason: "EFECTIVO" as const, note: "Pagado en efectivo por más de $2,000: el IVA no se acredita." }; }
    creditable += iva; return { ...base, ivaCreditMinor: iva, reason: "ACREDITABLE" as const, note: "IVA acreditable (CFDI y pago del mes)." };
  });

  const ivaNet = ivaCollected - creditable - ivaWith;
  const isrPayable = Math.max(0, caused - isrWith);
  return {
    income: { lines, baseMinor },
    isr: { rate, causedMinor: caused, withheldMinor: isrWith, payableMinor: isrPayable, creditMinor: Math.max(0, isrWith - caused), next: nextBracket(baseMinor) },
    iva: { collectedMinor: ivaCollected, creditableMinor: creditable, withheldMinor: ivaWith, payableMinor: Math.max(0, ivaNet), favorMinor: Math.max(0, -ivaNet) },
    totalPayableMinor: isrPayable + Math.max(0, ivaNet),
    expenses: { lines: eLines, creditableMinor: creditable, lostCashMinor: lostCash, withoutXmlMinor: withoutXml },
  };
}
