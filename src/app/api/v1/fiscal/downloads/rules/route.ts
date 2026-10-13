import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { ensureRules } from "@/lib/fiscal/download";

/** Activa la descarga masiva: crea (si faltan) las reglas de CFDI emitidos y recibidos vigentes y deja la sincronización periódica encendida. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const p = getFiscalProvider(); const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const { conn, org } = await withContext(ctx, async (tx) => ({
    conn: await tx.fiscal_provider_connections.findUnique({ where: { organization_id_provider: { organization_id: actor.organizationId, provider: p.name } } }),
    org: await tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { tax_id: true } }),
  }));
  if (!conn?.external_account_id) throw Problem.conflict("Primero configura el emisor fiscal de la organización.");
  try {
    const r = await ensureRules(conn.external_account_id, org.tax_id?.toUpperCase() ?? null);
    await withContext(ctx, async (tx) => {
      await tx.fiscal_provider_connections.update({ where: { id: conn.id }, data: { settings: { ...(conn.settings as object), sync_enabled: true }, updated_at: new Date() } });
      await audit(tx, { ...auditBase(actor), action: "fiscal.download_enabled", resourceType: "organization", resourceId: actor.organizationId, metadata: { rules_created: r.created.length, provider: p.name } });
    });
    return NextResponse.json({ rules: r.all, created: r.created.length });
  } catch (e) { if (e instanceof FiscalProviderError) throw new Problem(e.code === "NOT_CONFIGURED" ? 409 : 502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
});
