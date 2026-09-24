import { NextResponse } from "next/server";
import { withContext } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Salud del servicio. `?db=1` además prueba la conexión a la base (sin exponer credenciales). */
export async function GET(req: Request) {
  const body: Record<string, unknown> = { service: "procura", api: "v1", status: "ok", time: new Date().toISOString() };
  if (new URL(req.url).searchParams.get("db") === "1") {
    const t0 = Date.now();
    try {
      const [row] = await withContext({}, (tx) => tx.$queryRaw<{ u: string; rls: boolean }[]>`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as rls`);
      body.db = { status: "ok", user: row.u, bypass_rls: row.rls, ms: Date.now() - t0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      body.status = "degraded";
      body.db = { status: "error", ms: Date.now() - t0, error: msg.replace(/postgres(ql)?:\/\/[^\s"']+/g, "<url>").slice(0, 300) };
    }
  }
  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503 });
}
