import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Destino de los enlaces de correo de Supabase (confirmar cuenta, recuperar contraseña).
 * Canjea el `code` (PKCE) —o `token_hash`— por una sesión y redirige a `next` (solo rutas internas).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawNext = url.searchParams.get("next") ?? "/inicio";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/inicio";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const supabase = await supabaseServer();
  let error: unknown = new Error("Falta el código");
  if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
  else if (tokenHash && type) ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));

  if (error) return NextResponse.redirect(new URL(`/login?enlace=invalido`, url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
