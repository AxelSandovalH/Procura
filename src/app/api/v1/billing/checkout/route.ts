import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { env } from "@/lib/env";
import { requirePrimaryAdmin } from "@/lib/billing/guard";
import { PLAN_PRODUCT_ID, SERVICE_FEE_PRODUCT_ID, ensureProduct, ivaTaxRateId, stripe } from "@/lib/billing/stripe";
import { FINANCE_PLANS, SERVICE_FEE, chargeBreakdown } from "@/lib/commercial/plans";
import { getOrCreateCustomer } from "@/lib/billing/customer";

const Body = z.object({ plan: z.enum(["esencial", "control", "negocio"]) });

/** Inicia el pago de la suscripción mensual en Stripe (Checkout). Devuelve la URL a la que se envía a la persona. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  await requirePrimaryAdmin(actor);
  const { plan } = await json(req, (d) => Body.parse(d));
  const def = FINANCE_PLANS.find((p) => p.id === plan)!;
  const org = actor.organizationId;
  const sub = await withContext({ userId: actor.userId ?? undefined, organizationId: org }, (tx) => tx.organization_subscriptions.findUnique({ where: { organization_id: org } }));
  if (sub?.status === "ACTIVE" || (sub?.status === "PAST_DUE" && sub.plan)) throw Problem.conflict("Ya tienes una suscripción: cambia de plan o actualiza tu tarjeta desde «Administrar suscripción».");
  const customer = await getOrCreateCustomer(actor);
  const appUrl = env().APP_URL;
  const product = await ensureProduct(PLAN_PRODUCT_ID(plan), `Procura ${def.name}`, def.tagline);
  const feeProduct = await ensureProduct(SERVICE_FEE_PRODUCT_ID, SERVICE_FEE.label, "Cargo por el servicio de procesar el pago");
  const br = chargeBreakdown(def.price * 100), taxRate = await ivaTaxRateId();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription", customer, client_reference_id: org, locale: "es-419",
    // El precio lo pone Procura: mensual, en pesos y sin IVA; el IVA se suma con su tasa.
    line_items: [
      { price_data: { currency: "mxn", unit_amount: br.price, recurring: { interval: "month" }, product }, quantity: 1, tax_rates: [taxRate] },
      { price_data: { currency: "mxn", unit_amount: br.fee, recurring: { interval: "month" }, product: feeProduct }, quantity: 1, tax_rates: [taxRate] },
    ],
    subscription_data: { metadata: { organization_id: org, plan } }, metadata: { organization_id: org, plan, kind: "plan" },
    tax_id_collection: { enabled: true }, customer_update: { name: "auto", address: "auto" }, billing_address_collection: "required",
    success_url: `${appUrl}/suscripcion?pago=ok`, cancel_url: `${appUrl}/suscripcion?pago=cancelado`,
  });
  await withContext({ userId: actor.userId ?? undefined, organizationId: org }, (tx) => audit(tx, { ...auditBase(actor), action: "billing.checkout_started", resourceType: "organization", resourceId: org, metadata: { plan, session_id: session.id } }));
  return NextResponse.json({ url: session.url });
});
