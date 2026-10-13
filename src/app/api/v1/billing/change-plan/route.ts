import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { requirePrimaryAdmin } from "@/lib/billing/guard";
import { PLAN_PRODUCT_ID, ensureProduct, ivaTaxRateId, stripe } from "@/lib/billing/stripe";
import { FINANCE_PLANS } from "@/lib/commercial/plans";

const Body = z.object({ plan: z.enum(["esencial", "control", "negocio"]) });

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
  const s = stripe();
  const sub = await s.subscriptions.retrieve(cur.stripe_subscription_id);
  const item = sub.items.data[0];
  if (!item) throw Problem.conflict("La suscripción no tiene un cobro que cambiar.");
  await s.subscriptions.update(sub.id, {
    items: [{ id: item.id, price_data: { currency: "mxn", unit_amount: def.price * 100, recurring: { interval: "month" }, product }, tax_rates: [await ivaTaxRateId()] }],
    proration_behavior: "create_prorations", metadata: { ...sub.metadata, organization_id: org, plan },
  });
  await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "billing.plan_change_requested", resourceType: "organization", resourceId: org, metadata: { from: cur.plan, to: plan } }));
  return NextResponse.json({ ok: true, message: "Cambio solicitado: tu plan se actualiza en unos segundos." });
});
