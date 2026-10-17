import { describe, expect, it } from "vitest";
import { computeMonthlyTaxes, isrRate, splitWithheld, type ExpensePaymentOut, type SalePaymentIn } from "@/lib/finance/taxes";

const sale = (o: Partial<SalePaymentIn> = {}): SalePaymentIn => ({ saleId: "s", folio: "V1", description: "x", paidAt: "2026-10-10", amountMinor: 1160000, subtotalMinor: 1000000, discountMinor: 0, taxMinor: 160000, totalMinor: 1160000, withheldMinor: 0, ...o });
const exp = (o: Partial<ExpensePaymentOut> = {}): ExpensePaymentOut => ({ expenseId: "e", description: "g", supplier: null, paidAt: "2026-10-12", amountMinor: 116000, expenseAmountMinor: 116000, method: "CARD", ivaMinor: 16000, hasCfdi: true, pdfOnly: false, ...o });

describe("tasas RESICO", () => {
  it("tabla mensual por tramos", () => { expect(isrRate(2_500_000)).toBe(0.01); expect(isrRate(2_500_001)).toBe(0.011); expect(isrRate(8_333_333)).toBe(0.015); expect(isrRate(20_833_334)).toBe(0.025); });
  it("reparte lo retenido entre ISR (1.25 %) e IVA", () => { expect(splitWithheld(200609, 23906)).toEqual({ isr: 2508, iva: 21398 }); expect(splitWithheld(100000, 1250)).toEqual({ isr: 1250, iva: 0 }); });
});

describe("impuestos del mes", () => {
  it("una venta de 10,000 + IVA cobrada sin gastos", () => {
    const t = computeMonthlyTaxes([sale()], []);
    expect(t.income.baseMinor).toBe(1000000); expect(t.isr).toMatchObject({ rate: 0.01, causedMinor: 10000, payableMinor: 10000 });
    expect(t.iva).toMatchObject({ collectedMinor: 160000, creditableMinor: 0, payableMinor: 160000 }); expect(t.totalPayableMinor).toBe(170000);
  });
  it("el IVA de un gasto con CFDI pagado con tarjeta se acredita; sin XML o en efectivo > $2,000 no", () => {
    const t = computeMonthlyTaxes([sale()], [exp(), exp({ expenseId: "sin", hasCfdi: false, ivaMinor: 0 }), exp({ expenseId: "ef", method: "CASH", amountMinor: 232000, expenseAmountMinor: 232000, ivaMinor: 32000 }), exp({ expenseId: "ef2", method: "CASH", amountMinor: 100000, expenseAmountMinor: 100000, ivaMinor: 13793 })]);
    expect(t.expenses.creditableMinor).toBe(16000 + 13793); expect(t.expenses.lostCashMinor).toBe(32000); expect(t.expenses.withoutXmlMinor).toBe(116000);
    expect(t.iva.payableMinor).toBe(160000 - 16000 - 13793);
  });
  it("con retenciones: se reconoce el subtotal completo y se acreditan las retenciones (caso Papillon)", () => {
    const t = computeMonthlyTaxes([sale({ amountMinor: 208800, subtotalMinor: 200609, taxMinor: 32097, totalMinor: 232706, withheldMinor: 23906 })], []);
    expect(t.income.baseMinor).toBe(200609); expect(t.iva.collectedMinor).toBe(32097); expect(t.iva.withheldMinor).toBe(21398);
    expect(t.isr).toMatchObject({ causedMinor: 2006, withheldMinor: 2508, payableMinor: 0, creditMinor: 502 });
    expect(t.iva.payableMinor).toBe(10699); // 320.97 − 213.98
  });
  it("un cobro parcial reconoce solo su parte", () => {
    const t = computeMonthlyTaxes([sale({ amountMinor: 580000 })], []); expect(t.income.baseMinor).toBe(500000); expect(t.iva.collectedMinor).toBe(80000);
  });
  it("IVA a favor cuando los gastos superan al IVA cobrado", () => {
    const t = computeMonthlyTaxes([sale({ amountMinor: 116000, subtotalMinor: 100000, taxMinor: 16000, totalMinor: 116000 })], [exp({ amountMinor: 464000, expenseAmountMinor: 464000, ivaMinor: 64000 })]);
    expect(t.iva).toMatchObject({ payableMinor: 0, favorMinor: 48000 });
  });
  it("sin ingresos no hay ISR ni IVA a pagar", () => { const t = computeMonthlyTaxes([], []); expect(t.totalPayableMinor).toBe(0); });
});

import { nextBracket } from "@/lib/finance/taxes";
describe("siguiente tramo", () => {
  it("dice cuánto falta para subir de tasa", () => { expect(nextBracket(2_400_000)).toEqual({ atMinor: 2_500_001, rate: 0.011, remainingMinor: 100_001 }); expect(nextBracket(300_000_000)).toBeNull(); });
});

describe("una fila por venta", () => {
  it("varios cobros de una misma venta se suman en una sola línea", () => {
    const t = computeMonthlyTaxes([sale({ saleId: "S", amountMinor: 900000, paidAt: "2026-10-15", subtotalMinor: 900000, taxMinor: 144000, totalMinor: 1044000 }), sale({ saleId: "S", amountMinor: 144000, paidAt: "2026-10-16", subtotalMinor: 900000, taxMinor: 144000, totalMinor: 1044000 })], []);
    expect(t.income.lines).toHaveLength(1); expect(t.income.lines[0]).toMatchObject({ payments: 2, firstPaidAt: "2026-10-15", paidAt: "2026-10-16", baseMinor: 900000, ivaMinor: 144000 }); expect(t.income.baseMinor).toBe(900000);
  });
});
