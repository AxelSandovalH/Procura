import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({
  email: z.email(),
  password: z.string().min(10, "Mínimo 10 caracteres"),
  full_name: z.string().trim().min(2).max(120),
});

export const POST = route(async (req) => {
  const body = await json(req, (d) => Body.parse(d));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: { data: { full_name: body.full_name } },
  });
  if (error) throw new Problem(error.status ?? 400, "No se pudo registrar", error.message);
  // El trigger on_auth_user_created crea el perfil en public.users.
  return NextResponse.json(
    { user_id: data.user?.id, email_confirmation_required: !data.session },
    { status: 201 },
  );
});
