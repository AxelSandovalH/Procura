import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { route, json } from "@/lib/http/problem";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";

const Body = z.object({ email: z.email() });

/**
 * Pide el correo de recuperación. Responde siempre igual (202) exista o no la cuenta: no se enumeran usuarios.
 * El enlace vuelve a /auth/callback, que canjea el código por una sesión y lleva a /restablecer.
 */
export const POST = route(async (req) => {
  const { email } = await json(req, (d) => Body.parse(d));
  await rateLimit("forgot-ip", clientIp(req), { windowSeconds: 3600, max: 10 });
  await rateLimit("forgot-email", email.toLowerCase(), { windowSeconds: 3600, max: 3 });
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env().APP_URL}/auth/callback?next=/restablecer` });
  if (error) console.warn("[auth] resetPasswordForEmail:", error.status, error.message);
  return NextResponse.json({ message: "Si el correo existe, te enviamos un enlace para restablecer la contraseña." }, { status: 202 });
});
