import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { supabaseServer } from "@/lib/supabase/server";
import { ACTIVE_MEMBERSHIP_COOKIE } from "@/lib/auth/context";

export const POST = route(async () => {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(ACTIVE_MEMBERSHIP_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
});
