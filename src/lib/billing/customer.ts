import type { Actor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { stripe } from "@/lib/billing/stripe";

/** Cliente de Stripe de la organización: se crea una sola vez y se reutiliza (guardado en la suscripción). */
export async function getOrCreateCustomer(actor: Actor): Promise<string> {
  const org = actor.organizationId, ctx = { userId: actor.userId ?? undefined, organizationId: org };
  const cur = await withContext(ctx, (tx) => tx.organization_subscriptions.findUnique({ where: { organization_id: org }, select: { stripe_customer_id: true } }));
  if (cur?.stripe_customer_id) return cur.stripe_customer_id;
  const [o, u] = await withContext(ctx, async (tx) => Promise.all([tx.organizations.findUniqueOrThrow({ where: { id: org }, select: { legal_name: true, tax_id: true } }), actor.userId ? tx.public_users.findUnique({ where: { id: actor.userId }, select: { email: true } }) : null]));
  const c = await stripe().customers.create({ name: o.legal_name, ...(u?.email ? { email: u.email } : {}), metadata: { organization_id: org, ...(o.tax_id ? { rfc: o.tax_id } : {}) } }, { idempotencyKey: `procura-customer-${org}` });
  await withContext(ctx, (tx) => tx.organization_subscriptions.upsert({ where: { organization_id: org }, create: { organization_id: org, stripe_customer_id: c.id }, update: { stripe_customer_id: c.id, updated_at: new Date() } }));
  return c.id;
}
