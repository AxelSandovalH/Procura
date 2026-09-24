import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireUser, ACTIVE_MEMBERSHIP_COOKIE } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

const Body = z.object({ organization_id: z.uuid() });

/** Fija la organización activa: cookie con el membership id, validado en cada request contra la BD. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { organization_id } = await json(req, (d) => Body.parse(d));
  const m = await withContext({ userId: user.id }, (tx) =>
    tx.memberships.findFirst({ where: { user_id: user.id, organization_id, status: "ACTIVE" }, select: { id: true } }),
  );
  if (!m) throw Problem.notFound("No eres miembro activo de esa organización");
  const res = NextResponse.json({ membership_id: m.id, organization_id });
  res.cookies.set(ACTIVE_MEMBERSHIP_COOKIE, m.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
});
