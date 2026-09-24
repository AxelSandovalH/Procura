import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireUser } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { hashToken } from "@/lib/auth/token";

interface LookupRow {
  id: string; organization_id: string; kind: "MEMBERSHIP" | "RELATIONSHIP"; email: string | null;
  relationship_position: "BUYER" | "SUPPLIER" | null; auto_accept: boolean;
  status: "ACTIVE" | "EXPIRED" | "REVOKED"; expires_at: Date; max_uses: number; used_count: number;
  org_slug: string; org_display_name: string; role_names: string[];
}

/** Previsualiza una invitación por su token. Requiere sesión (nunca hay requisiciones/relaciones anónimas). */
export const GET = route(async (_req, params) => {
  await requireUser();
  const hash = hashToken(params.token);
  const [row] = await withContext({}, (tx) => tx.$queryRaw<LookupRow[]>`select * from app.lookup_invitation_by_hash(${hash})`);
  if (!row) throw Problem.notFound("Invitación no válida");

  const usable = row.status === "ACTIVE" && row.expires_at > new Date() && row.used_count < row.max_uses;
  return NextResponse.json({
    kind: row.kind,
    organization: { id: row.organization_id, slug: row.org_slug, display_name: row.org_display_name },
    relationship_position: row.relationship_position,
    auto_accept: row.auto_accept,
    role_names: row.role_names,
    usable,
    reason: usable ? null : row.status !== "ACTIVE" ? row.status.toLowerCase() : row.expires_at <= new Date() ? "expired" : "exhausted",
  });
});
