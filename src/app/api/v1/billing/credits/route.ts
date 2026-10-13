import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { env } from "@/lib/env";
import { requirePrimaryAdmin } from "@/lib/billing/guard";
import { PACK_PRODUCT_ID, SERVICE_FEE_PRODUCT_ID, ensureProduct, isPackSize, ivaTaxRateId, stripe } from "@/lib/billing/stripe";
import { SERVICE_FEE, STAMP_PACKS, chargeBreakdown } from "@/lib/commercial/plans";
import { getOrCreateCustomer } from "@/lib/billing/customer";

const Body = z.object({ pack: z.number().int() });

/** Inicia la compra de un paquete de créditos de timbrado (pago único, independiente de la suscripción). Los créditos se abonan al confirmarse el pago, por el aviso de Stripe. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  await requirePrimaryAdmin(actor);
  const { pack } = await json(req, (d) => Body.parse(d));
  if (!isPackSize(pack)) throw Problem.badRequest("Elige un paquete de 50, 100 o 500 timbres.");
  const def = STAMP_PACKS.proposed.find((p) => p.cfdi === pack)!;
  const org = actor.organizationId, customer = await getOrCreateCustomer(actor), appUrl = env().APP_URL;
  const product = await ensureProduct(PACK_PRODUCT_ID(pack), `Paquete de ${pack} timbres de CFDI`, "Créditos de timbrado, independientes de la suscripción");
  const feeProduct = await ensureProduct(SERVICE_FEE_PRODUCT_ID, SERVICE_FEE.label, "Cargo por el servicio de procesar el pago");
  const br = chargeBreakdown(def.priceMinor), taxRate = await ivaTaxRateId();
  const meta = { organization_id: org, kind: "stamp_pack", pack_size: String(pack) };
  const session = await stripe().checkout.sessions.create({
    mode: "payment", customer, client_reference_id: org, locale: "es-419", line_items: [
      { price_data: { currency: "mxn", unit_amount: br.price, product }, quantity: 1, tax_rates: [taxRate] },
      { price_data: { currency: "mxn", unit_amount: br.fee, product: feeProduct }, quantity: 1, tax_rates: [taxRate] },
    ],
    metadata: meta, payment_intent_data: { metadata: meta }, tax_id_collection: { enabled: true }, customer_update: { name: "auto", address: "auto" }, billing_address_collection: "required",
    success_url: `${appUrl}/suscripcion?creditos=ok`, cancel_url: `${appUrl}/suscripcion?creditos=cancelado`,
  });
  await withContext({ userId: actor.userId ?? undefined, organizationId: org }, (tx) => audit(tx, { ...auditBase(actor), action: "billing.credits_checkout_started", resourceType: "organization", resourceId: org, metadata: { pack, session_id: session.id } }));
  return NextResponse.json({ url: session.url });
});
