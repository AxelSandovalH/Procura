import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { env } from "@/lib/env";
import { requirePrimaryAdmin } from "@/lib/billing/guard";
import { stripe } from "@/lib/billing/stripe";

/** Portal de Stripe: cambiar de plan, actualizar la tarjeta, ver recibos o cancelar. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  await requirePrimaryAdmin(actor);
  const sub = await withContext({ userId: actor.userId ?? undefined, organizationId: actor.organizationId }, (tx) => tx.organization_subscriptions.findUnique({ where: { organization_id: actor.organizationId }, select: { stripe_customer_id: true } }));
  if (!sub?.stripe_customer_id) throw Problem.conflict("Aún no tienes una suscripción que administrar.");
  const s = await stripe().billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${env().APP_URL}/suscripcion` });
  return NextResponse.json({ url: s.url });
});
