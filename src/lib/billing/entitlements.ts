import { withContext } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

import { FEATURE_MIN_PLAN, PLAN_NAME, planIncludes, type Feature, type PlanId } from "@/lib/commercial/plans";
export { FEATURE_MIN_PLAN, PLAN_NAME };
export type { Feature, PlanId };
export const GRACE_DAYS = 7;

/** Las organizaciones creadas ANTES de esta fecha conservan acceso completo sin suscripción; las creadas después empiezan sin plan y deben contratar. */
export const BILLING_LEGACY_BEFORE = new Date("2026-10-13T15:00:00Z");

export type Effective = { kind: "LEGACY" } | { kind: "NEW" } | { kind: "PLAN"; plan: PlanId } | { kind: "LAPSED" };

/**
 * Plan efectivo de una organización:
 * - sin suscripción: LEGACY (acceso completo) si la organización es anterior al cobro (no se les quita nada); NEW (solo lo básico, a la espera de que contrate) si es posterior;
 * - suscripción activa, o con pago fallido dentro del periodo de gracia → su plan;
 * - cancelada, vencida o sin pagar tras la gracia → LAPSED: solo lo básico (nunca se borran datos).
 */
export async function effectivePlan(organizationId: string, now = new Date()): Promise<Effective> {
  const [s, org] = await withContext({ organizationId }, (tx) => Promise.all([tx.organization_subscriptions.findUnique({ where: { organization_id: organizationId } }), tx.organizations.findUnique({ where: { id: organizationId }, select: { created_at: true } })]));
  if (!s || (s.status === "NONE" && !s.plan)) return !org || org.created_at < BILLING_LEGACY_BEFORE ? { kind: "LEGACY" } : { kind: "NEW" };
  const plan = s.plan as PlanId | null;
  if (plan && (s.status === "ACTIVE" || (s.status === "PAST_DUE" && s.grace_until && s.grace_until > now))) return { kind: "PLAN", plan };
  return { kind: "LAPSED" };
}
export const allows = (e: Effective, feature: Feature) => e.kind === "LEGACY" || (e.kind === "PLAN" && planIncludes(e.plan, feature));
export const hasFeature = async (organizationId: string, feature: Feature) => allows(await effectivePlan(organizationId), feature);

/** 402 si el plan de la organización no incluye la función. */
export async function assertFeature(organizationId: string, feature: Feature): Promise<void> {
  const e = await effectivePlan(organizationId);
  if (allows(e, feature)) return;
  const need = PLAN_NAME[FEATURE_MIN_PLAN[feature]];
  throw new Problem(402, "No incluido en tu plan", e.kind === "NEW" ? `Elige un plan en Suscripción para usar esta función (desde ${need}).` : e.kind === "LAPSED" ? `Tu suscripción no está activa. Renueva tu plan (${need} o superior) en Suscripción para usar esta función.` : `Esta función está incluida desde el plan ${need}. Cambia de plan en Suscripción.`, { code: "PLAN_REQUIRED", required_plan: FEATURE_MIN_PLAN[feature] });
}
