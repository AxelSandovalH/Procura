/**
 * Planes y precios de la landing. Es la única fuente: para cambiar un precio, una función o un CTA se edita aquí.
 * Los precios son mensuales, en MXN, sin descuentos por plan anual.
 */
export const CURRENCY = "MXN";

/** Destino de los CTA de ventas. Aún no hay canal de contacto definido: mientras tanto llevan al registro. */
export const SALES_HREF = "/registro";

export interface Plan {
  id: "starter" | "business" | "enterprise" | "custom";
  name: string;
  /** Monto mensual en pesos. */
  price: number;
  /** Muestra «Desde» antes del precio. */
  priceFrom?: boolean;
  description: string;
  /** Encabezado de la lista de funciones (p. ej. «Incluye todo lo de Starter, más:»). */
  featuresLead: string;
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
  badge?: string;
  /** Cuota única de implementación; `null` = a cotizar. `plus` indica «desde». */
  implementation: { amount: number | null; plus?: boolean };
}

export const PLANS: Plan[] = [
  {
    id: "starter", name: "Starter", price: 1490,
    description: "Para empresas pequeñas que quieren dejar atrás Excel, WhatsApp y procesos manuales.",
    featuresLead: "Incluye:",
    features: ["Hasta 5 usuarios", "Requisiciones", "Flujos de aprobación", "Cotizaciones", "Comparativo de proveedores", "Órdenes de compra", "Recepción de compras", "Historial y bitácora", "Gestión de proveedores", "Catálogo", "Portal de proveedores", "Soporte estándar"],
    cta: { label: "Empezar con Procura", href: "/registro" },
    implementation: { amount: 5000 },
  },
  {
    id: "business", name: "Business", price: 3490, featured: true, badge: "Más popular",
    description: "Para empresas con operaciones de compras recurrentes y múltiples áreas involucradas.",
    featuresLead: "Incluye todo lo de Starter, más:",
    features: ["Hasta 20 usuarios", "Aprobaciones multinivel", "Múltiples áreas y departamentos", "Proveedores ilimitados", "Catálogos por proveedor", "Entregas parciales", "API", "Webhooks", "Roles y permisos avanzados", "Soporte prioritario"],
    cta: { label: "Elegir Business", href: "/registro" },
    implementation: { amount: 15000 },
  },
  {
    id: "enterprise", name: "Enterprise", price: 7990,
    description: "Para organizaciones donde procurement es una operación crítica.",
    featuresLead: "Incluye:",
    features: ["Usuarios ampliables", "Organizaciones y sucursales", "Flujos de aprobación avanzados", "API completa", "Webhooks", "Integraciones con ERP", "Soporte prioritario", "Onboarding personalizado"],
    cta: { label: "Hablar con ventas", href: SALES_HREF },
    implementation: { amount: 30000, plus: true },
  },
  {
    id: "custom", name: "Custom", price: 15000, priceFrom: true,
    description: "Para operaciones que necesitan Procura adaptado a sus procesos e infraestructura.",
    featuresLead: "Incluye:",
    features: ["Integraciones a medida", "Integración con ERP existente", "Flujos especiales", "Migración de datos", "Automatizaciones", "Desarrollo de módulos", "Infraestructura dedicada"],
    cta: { label: "Diseñar una solución", href: SALES_HREF },
    implementation: { amount: null },
  },
];

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
export const formatMoney = (n: number) => mxn.format(n);
