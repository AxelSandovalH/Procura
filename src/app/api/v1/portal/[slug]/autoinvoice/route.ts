import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { route } from "@/lib/http/problem";
import { findAutoinvoice } from "@/lib/portal/autoinvoice";

/** Pública (sin sesión): datos mínimos del portal de autofacturación de un comercio. */
export const GET = route(async (req, params) => {
  await rateLimit("autoinvoice-info-ip", clientIp(req), { windowSeconds: 60, max: 120 });
  const p = await findAutoinvoice(params.slug);
  return NextResponse.json({ portal: { slug: p.slug, display_name: p.display_name, welcome_text: p.welcome_text, window_days: p.window_days }, captcha_site_key: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null });
});
