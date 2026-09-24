import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

/** Solo organizaciones is_discoverable=true (R-01: oculto por defecto). */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.request");
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) throw Problem.badRequest("q debe tener al menos 2 caracteres");

  const results = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.organizations.findMany({
      where: { is_discoverable: true, status: "ACTIVE", id: { not: actor.organizationId }, OR: [{ display_name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] },
      select: { id: true, slug: true, display_name: true, country: true },
      take: 20,
    }),
  );
  return NextResponse.json({ data: results });
});
