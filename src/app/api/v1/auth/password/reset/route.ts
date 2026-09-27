import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireUser } from "@/lib/auth/context";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ password: z.string().min(10, "Mínimo 10 caracteres").max(128) });

/** Cambia la contraseña de la sesión actual (la de recuperación abierta desde el correo, o una sesión normal). */
export const POST = route(async (req) => {
  await requireUser();
  const { password } = await json(req, (d) => Body.parse(d));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Problem(error.status ?? 400, "No se pudo cambiar la contraseña", error.message);
  return NextResponse.json({ ok: true });
});
