import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

/** Prueba de conexión con el proveedor fiscal (solo lectura). Guarda el resultado, sin credenciales ni respuestas del proveedor. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const p = getFiscalProvider();
  const save = (status: "CONNECTED" | "ERROR", err: string | null) => withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await tx.fiscal_provider_connections.upsert({ where: { organization_id_provider: { organization_id: actor.organizationId, provider: p.name } },
      create: { organization_id: actor.organizationId, provider: p.name, status, last_error: err }, update: { status, last_error: err, updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "fiscal.connection_tested", resourceType: "organization", resourceId: actor.organizationId, metadata: { provider: p.name, status } });
  });
  try {
    const r = await p.testConnection();
    await save("CONNECTED", null);
    return NextResponse.json({ ok: true, provider: p.name, environment: r.environment });
  } catch (e) {
    if (e instanceof FiscalProviderError) {
      if (e.code !== "NOT_CONFIGURED") await save("ERROR", e.message);
      throw new Problem(e.code === "UNAUTHORIZED" ? 502 : e.code === "NOT_CONFIGURED" ? 409 : e.code === "RATE_LIMITED" ? 429 : 502, "Proveedor fiscal", e.message, { code: e.code });
    }
    throw e;
  }
});
