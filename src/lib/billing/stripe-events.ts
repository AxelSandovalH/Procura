import type Stripe from "stripe";
import { withContext, type Tx } from "@/lib/db/client";
import { planForProduct, isPackSize } from "@/lib/billing/stripe";
import { addLedger } from "@/lib/billing/credits";
import { audit } from "@/lib/audit";
import { GRACE_DAYS } from "@/lib/billing/entitlements";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLANS = ["esencial", "control", "negocio"] as const;
const SYSTEM = (organizationId: string) => ({ actorType: "SYSTEM" as const, actorId: null, membershipId: null, apiKeyId: null, organizationId });

async function ensureRow(tx: Tx, organizationId: string) {
  await tx.organization_subscriptions.upsert({ where: { organization_id: organizationId }, create: { organization_id: organizationId }, update: {} });
}
const periodEnd = (sub: Stripe.Subscription): Date | null => {
  const s = sub as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
  const t = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000) : null;
};
const customerId = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) => (typeof c === "string" ? c : c?.id ?? null);

/** Estado de Stripe → estado de Procura. */
export function mapStatus(s: Stripe.Subscription.Status): "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  return s === "active" || s === "trialing" ? "ACTIVE" : s === "past_due" || s === "unpaid" ? "PAST_DUE" : s === "canceled" ? "CANCELED" : "INCOMPLETE";
}

/** Abona los créditos de un paquete pagado. Idempotente por sesión de pago; al primer paquete la organización pasa a consumir créditos al timbrar. */
async function creditPack(orgId: string, session: Stripe.Checkout.Session): Promise<string> {
  const size = Number(session.metadata?.pack_size);
  if (!isPackSize(size)) return "paquete desconocido: se ignora";
  if (session.payment_status !== "paid") return "pago aún no confirmado";
  return withContext({ organizationId: orgId }, async (tx) => {
    await ensureRow(tx, orgId);
    const added = await addLedger(tx, orgId, size, "PURCHASE", session.id, `Paquete de ${size} timbres`);
    if (!added) return "ya abonado";
    await tx.organization_subscriptions.update({ where: { organization_id: orgId }, data: { credits_required: true, stripe_customer_id: customerId(session.customer) ?? undefined, updated_at: new Date() } }).catch(() => undefined);
    await audit(tx, { ...SYSTEM(orgId), action: "billing.credits_purchased", resourceType: "organization", resourceId: orgId, metadata: { session_id: session.id, credits: size } });
    return `abonados ${size} créditos`;
  });
}

async function syncSubscription(orgId: string, sub: Stripe.Subscription): Promise<string> {
  const product = sub.items?.data?.[0]?.price?.product;
  const metaPlan = PLANS.find((p) => p === sub.metadata?.plan);
  // El plan sale del producto cobrado (id fijo por plan); el metadato queda como respaldo.
  const plan = planForProduct(typeof product === "string" ? product : product?.id) ?? metaPlan ?? null;
  const status = mapStatus(sub.status);
  return withContext({ organizationId: orgId }, async (tx) => {
    await ensureRow(tx, orgId);
    const cur = await tx.organization_subscriptions.findUniqueOrThrow({ where: { organization_id: orgId } });
    const grace = status === "PAST_DUE" ? (cur.status === "PAST_DUE" && cur.grace_until ? cur.grace_until : new Date(Date.now() + GRACE_DAYS * 86_400_000)) : null;
    await tx.organization_subscriptions.update({ where: { organization_id: orgId }, data: { plan, status, stripe_customer_id: customerId(sub.customer), stripe_subscription_id: sub.id, current_period_end: periodEnd(sub), cancel_at_period_end: !!sub.cancel_at_period_end, grace_until: grace, updated_at: new Date() } });
    if (cur.status !== status || cur.plan !== plan) await audit(tx, { ...SYSTEM(orgId), action: "billing.subscription_changed", resourceType: "organization", resourceId: orgId, metadata: { from: { plan: cur.plan, status: cur.status }, to: { plan, status } } });
    return `suscripción ${status}${plan ? ` (${plan})` : ""}`;
  });
}

const orgFromMeta = (m: Stripe.Metadata | null | undefined) => (m?.organization_id && UUID.test(m.organization_id) ? m.organization_id : null);

async function orgByCustomer(cust: string | null): Promise<string | null> {
  if (!cust) return null;
  const rows = await withContext({}, (tx) => tx.$queryRaw<{ org: string | null }[]>`select app.org_by_stripe_customer(${cust}) as org`);
  return rows[0]?.org ?? null;
}

/** Procesa un evento ya verificado (firma) y deduplicado. Devuelve un resumen para el registro. */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      const org = orgFromMeta(s.metadata) ?? (s.client_reference_id && UUID.test(s.client_reference_id) ? s.client_reference_id : null);
      if (!org) return "sin organización: se ignora";
      if (s.mode === "payment" && s.metadata?.kind === "stamp_pack") return creditPack(org, s);
      if (s.mode === "subscription") {
        await withContext({ organizationId: org }, async (tx) => { await ensureRow(tx, org); await tx.organization_subscriptions.update({ where: { organization_id: org }, data: { stripe_customer_id: customerId(s.customer) ?? undefined, stripe_subscription_id: typeof s.subscription === "string" ? s.subscription : s.subscription?.id, updated_at: new Date() } }); });
        return "suscripción vinculada";
      }
      return "sesión sin acción";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const org = orgFromMeta(sub.metadata) ?? (await orgByCustomer(customerId(sub.customer)));
      if (!org) return "sin organización: se ignora";
      return syncSubscription(org, event.type === "customer.subscription.deleted" ? ({ ...sub, status: "canceled" } as Stripe.Subscription) : sub);
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const org = await orgByCustomer(customerId(inv.customer));
      if (!org) return "sin organización: se ignora";
      const failed = event.type === "invoice.payment_failed";
      return withContext({ organizationId: org }, async (tx) => {
        const cur = await tx.organization_subscriptions.findUnique({ where: { organization_id: org } });
        if (!cur || !cur.plan) return "sin plan: se ignora";
        if (failed) {
          await tx.organization_subscriptions.update({ where: { organization_id: org }, data: { status: "PAST_DUE", grace_until: cur.status === "PAST_DUE" && cur.grace_until ? cur.grace_until : new Date(Date.now() + GRACE_DAYS * 86_400_000), updated_at: new Date() } });
          await audit(tx, { ...SYSTEM(org), action: "billing.payment_failed", resourceType: "organization", resourceId: org, metadata: { invoice: inv.id } });
          return "pago fallido: periodo de gracia";
        }
        await tx.organization_subscriptions.update({ where: { organization_id: org }, data: { status: "ACTIVE", grace_until: null, updated_at: new Date() } });
        return "pago recibido";
      });
    }
    default: return "evento sin acción";
  }
}
