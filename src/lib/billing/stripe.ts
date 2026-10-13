import Stripe from "stripe";
import { env } from "@/lib/env";
import { Problem } from "@/lib/http/problem";

type PlanId = "esencial" | "control" | "negocio";
export const PACK_SIZES = [50, 100, 500] as const;
export type PackSize = (typeof PACK_SIZES)[number];

/** Cobro apagado mientras no haya clave secreta de Stripe. */
export const stripeEnabled = () => !!env().STRIPE_SECRET_KEY;

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Problem(409, "Cobro no configurado", "El cobro con Stripe aún no está activado en este entorno.");
  return (client ??= new Stripe(key, { timeout: 20_000, maxNetworkRetries: 1 }));
}

/**
 * Los precios los define Procura (`lib/commercial/plans.ts`) y se envían a Stripe en cada cobro: no hay que crear precios ni tasas a mano.
 * Stripe solo necesita un PRODUCTO por plan y por paquete, que se crea solo la primera vez con un id fijo (así nunca se duplica).
 */
export const PLAN_PRODUCT_ID = (plan: PlanId) => `procura_plan_${plan}`;
export const PACK_PRODUCT_ID = (size: PackSize) => `procura_pack_${size}`;
export const planForProduct = (productId: string | null | undefined): PlanId | null => (["esencial", "control", "negocio"] as const).find((p) => productId === PLAN_PRODUCT_ID(p)) ?? null;
export const SERVICE_FEE_PRODUCT_ID = "procura_service_fee";
export const isPackSize = (n: number): n is PackSize => (PACK_SIZES as readonly number[]).includes(n);

/** Devuelve el producto de Stripe con ese id; si no existe, lo crea. */
export async function ensureProduct(id: string, name: string, description?: string): Promise<string> {
  const s = stripe();
  try { const p = await s.products.retrieve(id); if (p.active) return p.id; await s.products.update(id, { active: true }); return id; }
  catch (e) {
    if ((e as { code?: string }).code !== "resource_missing") throw e;
    return (await s.products.create({ id, name, ...(description ? { description } : {}), metadata: { procura: "1" } })).id;
  }
}

let ivaRate: string | null = null;
/** Tasa de IVA 16% (no incluida en el precio): se reutiliza la que ya exista en tu Stripe, o se crea una vez. */
export async function ivaTaxRateId(): Promise<string> {
  if (ivaRate) return ivaRate;
  const s = stripe();
  const found = (await s.taxRates.list({ active: true, limit: 100 })).data.find((t) => t.percentage === 16 && !t.inclusive && /iva/i.test(t.display_name));
  ivaRate = found?.id ?? (await s.taxRates.create({ display_name: "IVA", percentage: 16, inclusive: false, country: "MX", jurisdiction: "MX", description: "IVA 16%" })).id;
  return ivaRate;
}

/** Qué parte del cobro está lista para usarse (para mostrarlo en la pantalla del plan). */
export function billingReadiness() {
  const on = stripeEnabled();
  return { enabled: on, webhook: !!env().STRIPE_WEBHOOK_SECRET, plans: { esencial: on, control: on, negocio: on }, packs: { 50: on, 100: on, 500: on } };
}
