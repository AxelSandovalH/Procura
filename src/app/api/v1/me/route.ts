import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireUser, ACTIVE_MEMBERSHIP_COOKIE } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

/** Usuario actual + sus memberships (todas las organizaciones) + cuál está activa. */
export const GET = route(async () => {
  const user = await requireUser();
  const active = (await cookies()).get(ACTIVE_MEMBERSHIP_COOKIE)?.value ?? null;
  const memberships = await withContext({ userId: user.id }, (tx) =>
    tx.memberships.findMany({
      where: { user_id: user.id, status: { in: ["ACTIVE", "PENDING", "SUSPENDED"] } },
      select: {
        id: true, status: true, is_primary_admin: true, title: true,
        organizations: { select: { id: true, slug: true, display_name: true } },
      },
      orderBy: { created_at: "asc" },
    }),
  );
  const [prefs] = await withContext({ userId: user.id }, (tx) => tx.$queryRaw<{ email_notifications: boolean }[]>`select email_notifications from users where id = ${user.id}::uuid`);
  return NextResponse.json({
    user: { id: user.id, email: user.email, full_name: user.fullName, email_notifications: prefs?.email_notifications ?? true },
    memberships: memberships.map((m) => ({
      id: m.id, status: m.status, is_primary_admin: m.is_primary_admin, title: m.title,
      organization: m.organizations, is_active: m.id === active,
    })),
  });
});

const Update = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  email_notifications: z.boolean().optional(),
});

/** Perfil propio: nombre y si quiere recibir correos de aviso. El correo (login) no se cambia aquí. */
export const PATCH = route(async (req) => {
  const user = await requireUser();
  const body = await json(req, (d) => Update.parse(d));
  await withContext({ userId: user.id }, async (tx) => {
    if (body.full_name !== undefined) await tx.$executeRaw`update users set full_name = ${body.full_name}, updated_at = now() where id = ${user.id}::uuid`;
    if (body.email_notifications !== undefined) await tx.$executeRaw`update users set email_notifications = ${body.email_notifications}, updated_at = now() where id = ${user.id}::uuid`;
  });
  return NextResponse.json({ ok: true });
});
