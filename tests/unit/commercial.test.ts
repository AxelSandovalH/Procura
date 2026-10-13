import { describe, expect, it } from "vitest";
import { FINANCE_PLANS, NOT_IMPLEMENTED, SAT_RECOVERY, STAMP_PACKS, TAX_NOTE, chargeBreakdown } from "@/lib/commercial/plans";
import { contribution, creditRevenueMinor, stampCostMinor } from "@/lib/commercial/economics";
import { FEATURE_MIN_PLAN, PLAN_NAME, allows } from "@/lib/billing/entitlements";
import { coveredByExisting } from "@/lib/fiscal/download";

describe("estructura comercial", () => {
  it("los precios son los definidos y Control es el recomendado", () => {
    expect(FINANCE_PLANS.map((p) => [p.id, p.price])).toEqual([["esencial", 499], ["control", 999], ["negocio", 1799], ["empresa", 4990]]);
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
    expect(SAT_RECOVERY.includedIn).toEqual(["negocio", "empresa"]);
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

describe("cargo por servicio de pago e IVA", () => {
  it("precio + 4% de cargo + 16% de IVA sobre ambos", () => {
    expect(chargeBreakdown(49_900)).toEqual({ price: 49_900, fee: 1_996, tax: 8_303, total: 60_199 });
    expect(chargeBreakdown(20_000)).toEqual({ price: 20_000, fee: 800, tax: 3_328, total: 24_128 });
  });
  it("el aviso de precios menciona el cargo", () => { expect(TAX_NOTE).toMatch(/4%/); });
});

describe("un solo esquema: lo anunciado coincide con lo que el sistema aplica", () => {
  const order = ["esencial", "control", "negocio", "empresa"];
  it("el plan mínimo de cada función respeta el orden de los planes", () => {
    expect(FEATURE_MIN_PLAN.procurement).toBe("control"); expect(FEATURE_MIN_PLAN.finance_reports).toBe("control"); expect(FEATURE_MIN_PLAN.bank).toBe("negocio"); expect(FEATURE_MIN_PLAN.advanced_approvals).toBe("negocio"); expect(FEATURE_MIN_PLAN.api).toBe("empresa");
    for (const p of order) expect(PLAN_NAME[p as keyof typeof PLAN_NAME]).toBeTruthy();
  });
  it("cada plan permite lo suyo y lo de los planes anteriores", () => {
    const can = (plan: string, f: Parameters<typeof allows>[1]) => allows({ kind: "PLAN", plan: plan as "esencial" }, f);
    expect([can("esencial", "procurement"), can("control", "procurement"), can("control", "bank"), can("negocio", "bank"), can("negocio", "api"), can("empresa", "api"), can("empresa", "procurement")]).toEqual([false, true, false, true, false, true, true]);
    expect(allows({ kind: "LEGACY" }, "api")).toBe(true); expect(allows({ kind: "NEW" }, "procurement")).toBe(false); expect(allows({ kind: "LAPSED" }, "cfdi")).toBe(false);
  });
  it("Empresa se muestra «desde» y hereda de Negocio; nadie promete lo no aplicado", () => {
    const e = FINANCE_PLANS.find((p) => p.id === "empresa")!; expect(e.priceFrom).toBe(true); expect(e.inherits).toBe("Negocio");
    const all = FINANCE_PLANS.flatMap((p) => p.features.map((f) => f.text)).join(" | ").toLowerCase();
    for (const bad of ["entregas parciales", "catálogos por proveedor", "usuarios ampliables", "organizaciones y sucursales"]) expect(all, bad).not.toContain(bad);
  });
});
