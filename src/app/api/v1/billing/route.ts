import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { creditBalance, availableCredits, creditLevel, LOW_CREDITS_THRESHOLD } from "@/lib/billing/credits";
import { billingReadiness } from "@/lib/billing/stripe";
import { effectivePlan, GRACE_DAYS } from "@/lib/billing/entitlements";

/** Plan, estado de la suscripción, saldo e historial de créditos de timbrado, y qué parte del cobro está lista. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.read");
  const org = actor.organizationId;
  const [eff, data] = await Promise.all([effectivePlan(org), withContext({ userId: actor.userId, organizationId: org }, async (tx) => {
    const [sub, balance, available, ledger, member] = await Promise.all([
      tx.organization_subscriptions.findUnique({ where: { organization_id: org } }), creditBalance(tx, org), availableCredits(tx, org),
      tx.stamp_credit_ledger.findMany({ where: { organization_id: org }, orderBy: { created_at: "desc" }, take: 25 }),
      actor.membershipId ? tx.memberships.findUnique({ where: { id: actor.membershipId }, select: { is_primary_admin: true } }) : null,
    ]);
    return { sub, balance, available, ledger, canManage: !!member?.is_primary_admin };
  })]);
  return NextResponse.json({
    access: eff.kind, plan: eff.kind === "PLAN" ? eff.plan : null,
    subscription: data.sub ? { plan: data.sub.plan, status: data.sub.status, current_period_end: data.sub.current_period_end, cancel_at_period_end: data.sub.cancel_at_period_end, grace_until: data.sub.grace_until, has_customer: !!data.sub.stripe_customer_id } : null,
    grace_days: GRACE_DAYS, can_manage: data.canManage, readiness: billingReadiness(),
    credits: { required: !!data.sub?.credits_required, balance: data.balance, available: data.available, level: creditLevel(data.available), low_threshold: LOW_CREDITS_THRESHOLD, history: data.ledger.map((l) => ({ id: l.id, delta: l.delta, kind: l.kind, note: l.note, created_at: l.created_at })) },
  });
});
