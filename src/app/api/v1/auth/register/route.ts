import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { route, json, Problem } from "@/lib/http/problem";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({
  email: z.email(),
  password: z.string().min(10, "Mínimo 10 caracteres"),
  full_name: z.string().trim().min(2).max(120),
  next: z.string().startsWith("/").max(300).optional(),
});

export const POST = route(async (req) => {
  const body = await json(req, (d) => Body.parse(d));
  await rateLimit("register-ip", clientIp(req), { windowSeconds: 3600, max: 10 });
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      data: { full_name: body.full_name },
      // El enlace de confirmación abre sesión en /auth/callback y sigue a `next` (p. ej. una invitación o un portal).
      emailRedirectTo: `${env().APP_URL}/auth/callback?next=${encodeURIComponent(body.next && !body.next.startsWith("//") ? body.next : "/inicio")}`,
    },
  });
  if (error) throw new Problem(error.status ?? 400, "No se pudo registrar", error.message);
  // El trigger on_auth_user_created crea el perfil en public.users.
  return NextResponse.json(
    { user_id: data.user?.id, email_confirmation_required: !data.session },
    { status: 201 },
  );
});
