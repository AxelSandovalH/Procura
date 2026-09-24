import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ email: z.email(), password: z.string().min(1) });

export const POST = route(async (req) => {
  const body = await json(req, (d) => Body.parse(d));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(body);
  if (error) throw Problem.unauthorized("Credenciales inválidas");
  return NextResponse.json({ user_id: data.user.id, expires_at: data.session.expires_at });
});
