import { FINANCE_PLANS, OBSERVED_COSTS, STAMP_PACKS } from "@/lib/commercial/plans";

/** Supuestos del cálculo de rentabilidad. Todo en centavos de MXN, sin IVA. Lo desconocido es un parámetro, no un número inventado. */
export interface Assumptions {
  /** Costo mensual de la descarga masiva por RFC (sin IVA). DESCONOCIDO: el proveedor solo mostró un cargo prorrateado. */
  downloadMonthlyMinor: number;
  /** Si la suscripción de emisión de Fiscalapi se paga por cada RFC emisor (DESCONOCIDO). */
  emissionSubscriptionPerRfc: boolean;
  /** Costo de OCR por escaneo (DESCONOCIDO: aún no se mide). */
  ocrPerScanMinor: number;
  /** Escaneos al mes. */
  scans: number;
  /** Comisión de la pasarela de cobro (tarifa pública de lista de Stripe México; verificar): porcentaje + fija + IVA sobre la comisión. */
  feeRate: number; feeFixedMinor: number;
}
export const DEFAULT_ASSUMPTIONS: Assumptions = { downloadMonthlyMinor: 0, emissionSubscriptionPerRfc: false, ocrPerScanMinor: 0, scans: 0, feeRate: 0.036, feeFixedMinor: 300 };

const net = (withTax: number) => withTax / (1 + OBSERVED_COSTS.vatRate);
export const stampCostMinor = () => Math.round(net(OBSERVED_COSTS.stampPackWithTaxMinor / OBSERVED_COSTS.stampPackSize)); // costo por timbre sin IVA, en centavos (147 = $1.47)
export const emissionSubscriptionMinor = () => Math.round(net(OBSERVED_COSTS.emissionSubscriptionWithTaxMinor));

/** Ingreso por crédito consumido: el precio del paquete comprado dividido entre su tamaño (se compra el paquete más chico que alcance). */
export function creditRevenueMinor(emitted: number): number {
  if (emitted <= 0) return 0;
  const pack = STAMP_PACKS.proposed.find((p) => p.cfdi >= emitted) ?? STAMP_PACKS.proposed[STAMP_PACKS.proposed.length - 1]!;
  return Math.round((pack.priceMinor / pack.cfdi) * emitted);
}

export interface Scenario { plan: string; recovered: number; emitted: number }
/** Margen de contribución mensual (antes de infraestructura y gastos generales). Recuperados del SAT y emitidos se calculan por separado. */
export function contribution(s: Scenario, a: Assumptions = DEFAULT_ASSUMPTIONS) {
  const plan = FINANCE_PLANS.find((p) => p.id === s.plan)!;
  const subscription = plan.price * 100;
  const credits = creditRevenueMinor(s.emitted);
  const stampCost = s.emitted * stampCostMinor();
  const emissionFixed = s.emitted > 0 && a.emissionSubscriptionPerRfc ? emissionSubscriptionMinor() : 0;
  const recoveryCost = s.recovered > 0 && SAT_INCLUDED(plan.id) ? a.downloadMonthlyMinor : 0;
  const ocr = SAT_INCLUDED(plan.id) ? a.scans * a.ocrPerScanMinor : 0;
  const charged = Math.round((subscription + credits) * (1 + OBSERVED_COSTS.vatRate));            // lo que paga el cliente con IVA
  const fees = Math.round((charged * a.feeRate + a.feeFixedMinor) * (1 + OBSERVED_COSTS.vatRate)); // comisión con IVA (no se acredita)
  const costs = stampCost + emissionFixed + recoveryCost + ocr + fees;
  return { subscription, credits, stampCost, emissionFixed, recoveryCost, ocr, fees, contribution: subscription + credits - costs };
}
const SAT_INCLUDED = (id: string) => id === "negocio";
