import { describe, expect, it } from "vitest";
import { FINANCE_PLANS, NOT_IMPLEMENTED, SAT_RECOVERY, STAMP_PACKS } from "@/lib/commercial/plans";
import { contribution, creditRevenueMinor, stampCostMinor } from "@/lib/commercial/economics";
import { coveredByExisting } from "@/lib/fiscal/download";

describe("estructura comercial", () => {
  it("los precios son los definidos y Control es el recomendado", () => {
    expect(FINANCE_PLANS.map((p) => [p.id, p.price])).toEqual([["esencial", 499], ["control", 999], ["negocio", 1799]]);
    expect(FINANCE_PLANS.filter((p) => p.featured).map((p) => p.id)).toEqual(["control"]);
  });
  it("cada prestación anunciada indica dónde existe en el producto", () => { for (const p of FINANCE_PLANS) for (const f of p.features) expect(f.verified.length, f.text).toBeGreaterThan(2); });
  it("no se anuncia nada que se sabe no implementado", () => {
    const text = FINANCE_PLANS.flatMap((p) => p.features.map((f) => f.text)).join(" | ").toLowerCase();
    for (const bad of ["exportación", "exportar", "ilimitad", "stripe", "pdf de estados", "conexión directa"]) expect(text, bad).not.toContain(bad);
    expect(NOT_IMPLEMENTED.length).toBeGreaterThan(0);
  });
  it("los límites de recuperación del SAT siguen pendientes y sin cobro de excedente", () => {
    expect(SAT_RECOVERY.limits.requestsPerMonth).toBeNull(); expect(SAT_RECOVERY.limits.cfdiPerMonth).toBeNull(); expect(SAT_RECOVERY.overage.enabled).toBe(false);
    expect(SAT_RECOVERY.includedIn).toEqual(["negocio"]);
  });
  it("los paquetes de timbrado no están disponibles todavía", () => { expect(STAMP_PACKS.available).toBe(false); });
});

describe("rentabilidad", () => {
  it("el timbre cuesta $1.47 sin IVA (100 timbres = $170.52 con IVA)", () => { expect(stampCostMinor()).toBe(147); });
  it("el ingreso por crédito sale del paquete más chico que alcance", () => {
    expect(creditRevenueMinor(25)).toBe(10_000); expect(creditRevenueMinor(50)).toBe(20_000); expect(creditRevenueMinor(100)).toBe(35_000); expect(creditRevenueMinor(500)).toBe(125_000); expect(creditRevenueMinor(0)).toBe(0);
  });
  it("recuperar CFDI y emitir se calculan por separado", () => {
    const solo = contribution({ plan: "negocio", recovered: 100, emitted: 0 }, { downloadMonthlyMinor: 10_000, emissionSubscriptionPerRfc: false, ocrPerScanMinor: 0, scans: 0, feeRate: 0, feeFixedMinor: 0 });
    expect(solo.credits).toBe(0); expect(solo.stampCost).toBe(0); expect(solo.recoveryCost).toBe(10_000);
    const emit = contribution({ plan: "negocio", recovered: 0, emitted: 100 }, { downloadMonthlyMinor: 10_000, emissionSubscriptionPerRfc: false, ocrPerScanMinor: 0, scans: 0, feeRate: 0, feeFixedMinor: 0 });
    expect(emit.recoveryCost).toBe(0); expect(emit.stampCost).toBe(100 * 147);
  });
  it("Esencial y Control no incluyen recuperación del SAT: no tienen ese costo", () => {
    expect(contribution({ plan: "control", recovered: 500, emitted: 0 }, { downloadMonthlyMinor: 99_999, emissionSubscriptionPerRfc: false, ocrPerScanMinor: 0, scans: 0, feeRate: 0, feeFixedMinor: 0 }).recoveryCost).toBe(0);
  });
});

describe("solicitudes al SAT repetidas", () => {
  const day = 86_400_000, t = (s: string) => Date.parse(s);
  const ex = [{ ruleId: "r1", status: "Completada", startDate: "2026-09-30T18:00:00.000", endDate: "2026-10-13T11:01:15.467" }];
  it("un periodo ya cubierto no se vuelve a pedir", () => { expect(coveredByExisting(ex, "r1", t("2026-09-30T18:00:00"), t("2026-10-13T11:00:00"))).toBe(true); });
  it("tolera la diferencia de zona horaria (menos de 24 h)", () => { expect(coveredByExisting(ex, "r1", t("2026-09-30T12:00:00"), t("2026-10-13T11:00:00"))).toBe(true); });
  it("un periodo que se extiende más allá sí se pide", () => { expect(coveredByExisting(ex, "r1", t("2026-09-30T18:00:00"), t("2026-10-13T11:00:00") + 3 * day)).toBe(false); });
  it("otra regla, o una solicitud rechazada, no cuentan", () => {
    expect(coveredByExisting(ex, "r2", t("2026-10-01T00:00:00"), t("2026-10-10T00:00:00"))).toBe(false);
    expect(coveredByExisting([{ ...ex[0]!, status: "Rechazada" }], "r1", t("2026-10-01T00:00:00"), t("2026-10-10T00:00:00"))).toBe(false);
    expect(coveredByExisting([{ ...ex[0]!, status: "Abandonada" }], "r1", t("2026-10-01T00:00:00"), t("2026-10-10T00:00:00"))).toBe(false);
  });
});
