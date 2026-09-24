import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import type { membership_status } from "@prisma/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "member.read");
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as membership_status | null;

  const members = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.memberships.findMany({
      where: { organization_id: actor.organizationId, ...(status ? { status } : {}) },
      orderBy: { created_at: "asc" },
      select: {
        id: true, status: true, requested_by: true, is_primary_admin: true, title: true,
        default_department_id: true, default_location_id: true, created_at: true, activated_at: true,
        users: { select: { id: true, email: true, full_name: true } },
        role_assignments_role_assignments_membership_idTomemberships: {
          where: { revoked_at: null },
          select: { id: true, scope_type: true, scope_id: true, roles: { select: { id: true, name: true } } },
        },
      },
    }),
  );
  return NextResponse.json({
    data: members.map((m) => ({
      id: m.id, status: m.status, requested_by: m.requested_by, is_primary_admin: m.is_primary_admin, title: m.title,
      default_department_id: m.default_department_id, default_location_id: m.default_location_id,
      created_at: m.created_at, activated_at: m.activated_at,
      user: m.users,
      role_assignments: m.role_assignments_role_assignments_membership_idTomemberships.map((ra) => ({ id: ra.id, role: ra.roles, scope_type: ra.scope_type, scope_id: ra.scope_id })),
    })),
  });
});
