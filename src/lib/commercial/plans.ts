/**
 * Estructura comercial de Procura (finanzas y fiscal): ÚNICA fuente para la página de precios y para el análisis de rentabilidad.
 * Es información comercial: hoy NO hay cobros, suscripciones ni límites aplicados en el sistema (no existe Stripe ni créditos). Nada de aquí cobra o bloquea.
 * Una prestación solo aparece como incluida si está implementada (`verified` la respalda en el código); lo demás va en `PENDING`.
 */
export const CURRENCY = "MXN";
/** Cargo por servicio de pago que se suma a cada cobro (suscripción y paquetes), antes del IVA. */
export const SERVICE_FEE = { rate: 0.04, label: "Cargo por servicio de pago" } as const;
export const VAT_RATE = 0.16;
export const TAX_NOTE = "Precios en pesos mexicanos (MXN) más IVA. Cada pago incluye además un cargo por servicio de pago de 4%.";

/** Desglose de un cobro, en centavos: precio + cargo (4% del precio) + IVA (16% sobre precio y cargo). Stripe es la fuente final de los centavos. */
export function chargeBreakdown(priceMinor: number) {
  const fee = Math.round(priceMinor * SERVICE_FEE.rate), tax = Math.round((priceMinor + fee) * VAT_RATE);
  return { price: priceMinor, fee, tax, total: priceMinor + fee + tax };
}

export interface PlanFeature { text: string; /** dónde vive en el producto, para auditar que existe */ verified: string }
export interface FinancePlan {
  id: "esencial" | "control" | "negocio"; name: string; price: number; tagline: string; featured?: boolean;
  inherits: string | null; features: PlanFeature[];
}

export const FINANCE_PLANS: FinancePlan[] = [
  {
    id: "esencial", name: "Esencial", price: 499, inherits: null, tagline: "Para pequeños negocios que necesitan organizar su administración.",
    features: [
      { text: "Registro de ingresos (ventas) y de gastos", verified: "/ventas, /gastos" },
      { text: "Comprobante de cada gasto (foto o PDF) con vista previa", verified: "gastos/[id]/receipt" },
      { text: "Notas con fecha y autor en cada gasto", verified: "gastos/[id]/notes" },
      { text: "Listados con estado de pago, de cobro y de facturación", verified: "/gastos, /ventas" },
    ],
  },
  {
    id: "control", name: "Control", price: 999, inherits: "Esencial", featured: true, tagline: "Para negocios que necesitan controlar sus operaciones financieras.",
    features: [
      { text: "Pagos y cobros parciales, y pago de varios gastos a la vez", verified: "payments, gastos/mark-paid" },
      { text: "Saldos por cobrar y por pagar", verified: "finance/summary" },
      { text: "Carga de CFDI (XML, PDF o ZIP) y vínculo con cada gasto o venta", verified: "/facturas, cfdi_links" },
      { text: "Crear gastos a partir de tus facturas recibidas", verified: "cfdi/expenses" },
      { text: "Reportes de Finanzas: tendencia, categorías, proveedores y gasto con y sin CFDI", verified: "/finanzas, finance/charts" },
      { text: "Datos fiscales listos para pedir tu factura y lista de gastos sin CFDI para revisar con tu contador", verified: "billing-data, /finanzas" },
    ],
  },
  {
    id: "negocio", name: "Negocio", price: 1799, inherits: "Control", tagline: "Para empresas que centralizan su administración y su documentación fiscal.",
    features: [
      { text: "Recuperación de tus CFDI recibidos del SAT mediante Fiscalapi, sujeta a límites de uso", verified: "fiscal/downloads, lib/fiscal/download" },
      { text: "OCR: lectura de tickets y recibos (foto o PDF) con confirmación antes de guardar", verified: "gastos/scan" },
      { text: "Detección de posibles duplicados al escanear y al cargar CFDI", verified: "gastos/scan, cfdi_documents unique" },
      { text: "Conciliación bancaria por archivo CSV, con sugerencias", verified: "/banco" },
      { text: "Emisión, PDF y cancelación de CFDI 4.0 con retenciones de RESICO; el timbrado se paga aparte", verified: "sales/[id]/invoice, cfdi/[id]/cancel" },
      { text: "Portal público de autofacturación para tus clientes (consume tus timbres)", verified: "[slug]/facturar" },
    ],
  },
];

/** Lo que NO se anuncia como incluido porque no existe todavía. */
export const NOT_IMPLEMENTED = [
  "Exportación de información fiscal y financiera (no hay exportación de datos; solo importaciones)",
  "Conexión directa a bancos (la conciliación es por archivo CSV)",
  "Lectura de estados de cuenta en PDF",
  "Límites de usuarios y almacenamiento por plan (el sistema no los aplica)",
  "Cobro de suscripciones y compra de créditos (no hay pasarela de pago)",
] as const;

/** Recuperación de CFDI del SAT: servicio SEPARADO del timbrado. Los límites están PENDIENTES hasta conocer el costo real por RFC del proveedor. */
export const SAT_RECOVERY = {
  includedIn: ["negocio"] as const,
  /** null = pendiente de definir. Mientras tanto no se promete ningún volumen ni se cobra excedente. */
  limits: { requestsPerMonth: null as number | null, cfdiPerMonth: null as number | null },
  overage: { enabled: false },
  unit: "RFC", // el proveedor cobra por RFC y dirección (recibidos / emitidos), no por CFDI
} as const;

/** Créditos de timbrado: propuesta comercial. `available: false` hasta que existan prepago, saldo y cobro; no se muestran precios al público. */
export const STAMP_PACKS = {
  available: false,
  proposed: [{ cfdi: 50, priceMinor: 20_000 }, { cfdi: 100, priceMinor: 35_000 }, { cfdi: 500, priceMinor: 125_000 }],
} as const;

/** Costos reales observados en los gastos de la organización (ver docs/PRICING.md). Montos en centavos; los de Fiscalapi se capturaron con IVA incluido. */
export const OBSERVED_COSTS = {
  stampPackWithTaxMinor: 17_052, stampPackSize: 100, // 100 timbres = $170.52 con IVA
  emissionSubscriptionWithTaxMinor: 19_900, // suscripción de emisión: $199.00 al mes con IVA
  downloadProratedWithTaxMinor: 9_894, // descarga masiva: $98.94 por «tiempo restante» (el mes completo NO se conoce)
  vatRate: 0.16,
} as const;
