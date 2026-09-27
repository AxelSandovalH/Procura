import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { route, json, Problem } from "@/lib/http/problem";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ email: z.email(), password: z.string().min(1) });

export const POST = route(async (req) => {
  const body = await json(req, (d) => Body.parse(d));
  await rateLimit("login-ip", clientIp(req), { windowSeconds: 600, max: 30 });
  await rateLimit("login-email", body.email.toLowerCase(), { windowSeconds: 900, max: 10 });
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(body);
  if (error) throw Problem.unauthorized("Credenciales inválidas");
  return NextResponse.json({ user_id: data.user.id, expires_at: data.session.expires_at });
});
