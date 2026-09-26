import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const unreadOnly = sp.get("unread") === "1";
  if (!actor.membershipId) return NextResponse.json({ data: [] });
  const notifications = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.notifications.findMany({
      where: { membership_id: actor.membershipId!, ...(unreadOnly ? { read_at: null } : {}) },
      orderBy: { created_at: "desc" }, take: 100,
    }),
  );
  return NextResponse.json({ data: notifications });
});
