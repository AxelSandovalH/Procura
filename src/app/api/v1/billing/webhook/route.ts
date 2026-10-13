import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { prisma } from "@/lib/db/client";
import { env } from "@/lib/env";
import { stripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/stripe-events";

export const dynamic = "force-dynamic";

/**
 * Avisos de Stripe. Pública, pero solo acepta eventos con firma válida (STRIPE_WEBHOOK_SECRET). Cada evento se procesa una sola vez;
 * si falla, se libera para que Stripe lo reintente. Nunca se confía en datos del cuerpo sin verificar la firma.
 */
export async function POST(req: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse("Webhook no configurado", { status: 503 });
  const raw = await req.text();
  let event: Stripe.Event;
  try { event = stripe().webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret); }
  catch { return new NextResponse("Firma inválida", { status: 400 }); }
  const db = prisma();
  const [claim] = await db.$queryRaw<{ ok: boolean }[]>`select app.stripe_event_claim(${event.id}, ${event.type}) as ok`;
  if (!claim?.ok) return NextResponse.json({ received: true, duplicate: true });
  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    await db.$executeRaw`select app.stripe_event_release(${event.id})`.catch(() => undefined);
    Sentry.captureException(e);
    return new NextResponse("Error al procesar el evento", { status: 500 });
  }
}
