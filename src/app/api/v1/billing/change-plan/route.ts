import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { requirePrimaryAdmin } from "@/lib/billing/guard";
import { PLAN_PRODUCT_ID, SERVICE_FEE_PRODUCT_ID, ensureProduct, ivaTaxRateId, planForProduct, stripe } from "@/lib/billing/stripe";
import { FINANCE_PLANS, SERVICE_FEE, chargeBreakdown } from "@/lib/commercial/plans";

const Body = z.object({ plan: z.enum(["esencial", "control", "negocio", "empresa"]) });

/**
 * Cambia el plan de una suscripción activa con el precio que define Procura; Stripe prorratea la diferencia. El plan de la organización NO se
 * cambia aquí: lo actualiza el aviso (webhook) de Stripe cuando el cambio queda aplicado.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  await requirePrimaryAdmin(actor);
  const { plan } = await json(req, (d) => Body.parse(d));
  const org = actor.organizationId, ctx = { userId: actor.userId ?? undefined, organizationId: org };
  const cur = await withContext(ctx, (tx) => tx.organization_subscriptions.findUnique({ where: { organization_id: org } }));
  if (!cur?.stripe_subscription_id || !["ACTIVE", "PAST_DUE"].includes(cur.status)) throw Problem.conflict("No tienes una suscripción activa que cambiar: contrata un plan primero.");
  if (cur.plan === plan) throw Problem.conflict("Ya estás en ese plan.");
  const def = FINANCE_PLANS.find((p) => p.id === plan)!;
  const product = await ensureProduct(PLAN_PRODUCT_ID(plan), `Procura ${def.name}`, def.tagline);
  const feeProduct = await ensureProduct(SERVICE_FEE_PRODUCT_ID, SERVICE_FEE.label, "Cargo por el servicio de procesar el pago");
  const br = chargeBreakdown(def.price * 100), taxRate = await ivaTaxRateId();
  const s = stripe();
  const sub = await s.subscriptions.retrieve(cur.stripe_subscription_id);
  const productOf = (i: (typeof sub.items.data)[number]) => (typeof i.price.product === "string" ? i.price.product : i.price.product.id);
  const planItem = sub.items.data.find((i) => planForProduct(productOf(i))), feeItem = sub.items.data.find((i) => productOf(i) === SERVICE_FEE_PRODUCT_ID);
  if (!planItem) throw Problem.conflict("La suscripción no tiene un cobro de plan que cambiar.");
  const recurring = { interval: "month" as const };
  await s.subscriptions.update(sub.id, {
    items: [
      { id: planItem.id, price_data: { currency: "mxn", unit_amount: br.price, recurring, product }, tax_rates: [taxRate] },
      feeItem ? { id: feeItem.id, price_data: { currency: "mxn", unit_amount: br.fee, recurring, product: feeProduct }, tax_rates: [taxRate] } : { price_data: { currency: "mxn", unit_amount: br.fee, recurring, product: feeProduct }, quantity: 1, tax_rates: [taxRate] },
    ],
    proration_behavior: "create_prorations", metadata: { ...sub.metadata, organization_id: org, plan },
  });
  await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "billing.plan_change_requested", resourceType: "organization", resourceId: org, metadata: { from: cur.plan, to: plan } }));
  return NextResponse.json({ ok: true, message: "Cambio solicitado: tu plan se actualiza en unos segundos." });
});
