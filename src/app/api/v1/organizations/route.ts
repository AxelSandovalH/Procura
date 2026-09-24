import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireUser, ACTIVE_MEMBERSHIP_COOKIE } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/, "Solo minúsculas, números y guiones"),
  legal_name: z.string().trim().min(2).max(200),
  display_name: z.string().trim().min(2).max(120),
  tax_id: z.string().trim().max(20).optional(),
  country: z.string().length(2).default("MX"),
  base_currency: z.string().regex(/^[A-Z]{3}$/).default("MXN"),
  timezone: z.string().default("America/Mazatlan"),
});

/**
 * Crea una organización. El trigger app.bootstrap_organization crea settings, roles base
 * y hace al creador administrador principal. La respuesta ya deja esa organización activa.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await json(req, (d) => Body.parse(d));

  const result = await withContext({ userId: user.id }, async (tx) => {
    const exists = await tx.organizations.findUnique({ where: { slug: body.slug }, select: { id: true } });
    if (exists) throw Problem.conflict(`El slug "${body.slug}" ya está en uso`);
    const org = await tx.organizations.create({ data: { ...body, created_by_user_id: user.id }, select: { id: true, slug: true, display_name: true } });
    const membership = await tx.memberships.findFirstOrThrow({ where: { organization_id: org.id, user_id: user.id }, select: { id: true } });
    return { org, membershipId: membership.id };
  });

  const res = NextResponse.json({ organization: result.org, membership_id: result.membershipId }, { status: 201 });
  res.cookies.set(ACTIVE_MEMBERSHIP_COOKIE, result.membershipId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
});
