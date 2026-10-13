import { withContext } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

export type Feature = "finance_reports" | "cfdi" | "bank" | "sat_recovery" | "ocr" | "issuing";
export type PlanId = "esencial" | "control" | "negocio";
const RANK: Record<PlanId, number> = { esencial: 1, control: 2, negocio: 3 };
/** Plan mínimo que incluye cada función (alineado con la página de precios, `lib/commercial/plans.ts`). */
export const FEATURE_MIN_PLAN: Record<Feature, PlanId> = { finance_reports: "control", cfdi: "control", bank: "negocio", sat_recovery: "negocio", ocr: "negocio", issuing: "negocio" };
export const PLAN_NAME: Record<PlanId, string> = { esencial: "Esencial", control: "Control", negocio: "Negocio" };
export const GRACE_DAYS = 7;

export type Effective = { kind: "LEGACY" } | { kind: "PLAN"; plan: PlanId } | { kind: "LAPSED" };

/**
 * Plan efectivo de una organización:
 * - sin suscripción registrada → LEGACY: acceso completo (organizaciones anteriores al cobro; no se les quita nada);
 * - suscripción activa, o con pago fallido dentro del periodo de gracia → su plan;
 * - cancelada, vencida o sin pagar tras la gracia → LAPSED: solo lo básico (nunca se borran datos).
 */
export async function effectivePlan(organizationId: string, now = new Date()): Promise<Effective> {
  const s = await withContext({ organizationId }, (tx) => tx.organization_subscriptions.findUnique({ where: { organization_id: organizationId } }));
  if (!s || (s.status === "NONE" && !s.plan)) return { kind: "LEGACY" };
  const plan = s.plan as PlanId | null;
  if (plan && (s.status === "ACTIVE" || (s.status === "PAST_DUE" && s.grace_until && s.grace_until > now))) return { kind: "PLAN", plan };
  return { kind: "LAPSED" };
}
export const allows = (e: Effective, feature: Feature) => e.kind === "LEGACY" || (e.kind === "PLAN" && RANK[e.plan] >= RANK[FEATURE_MIN_PLAN[feature]]);
export const hasFeature = async (organizationId: string, feature: Feature) => allows(await effectivePlan(organizationId), feature);

/** 402 si el plan de la organización no incluye la función. */
export async function assertFeature(organizationId: string, feature: Feature): Promise<void> {
  const e = await effectivePlan(organizationId);
  if (allows(e, feature)) return;
  const need = PLAN_NAME[FEATURE_MIN_PLAN[feature]];
  throw new Problem(402, "No incluido en tu plan", e.kind === "LAPSED" ? `Tu suscripción no está activa. Renueva tu plan (${need} o superior) en Administración → Plan para usar esta función.` : `Esta función está incluida desde el plan ${need}. Cambia de plan en Administración → Plan.`, { code: "PLAN_REQUIRED", required_plan: FEATURE_MIN_PLAN[feature] });
}
