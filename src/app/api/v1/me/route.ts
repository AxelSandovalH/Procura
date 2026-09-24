import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { route } from "@/lib/http/problem";
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
  return NextResponse.json({
    user: { id: user.id, email: user.email, full_name: user.fullName },
    memberships: memberships.map((m) => ({
      id: m.id, status: m.status, is_primary_admin: m.is_primary_admin, title: m.title,
      organization: m.organizations, is_active: m.id === active,
    })),
  });
});
