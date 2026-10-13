import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { findRules } from "@/lib/fiscal/download";

/** Estado de la descarga masiva (solo lectura): reglas, solicitudes pendientes/listas e importaciones ya hechas. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.read");
  const p = getFiscalProvider();
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const { conn, org, imports } = await withContext(ctx, async (tx) => ({
    conn: await tx.fiscal_provider_connections.findUnique({ where: { organization_id_provider: { organization_id: actor.organizationId, provider: p.name } } }),
    org: await tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { tax_id: true } }),
    imports: await tx.fiscal_sync_imports.findMany({ where: { organization_id: actor.organizationId }, orderBy: { updated_at: "desc" }, take: 20 }),
  }));
  const sync_enabled = (conn?.settings as { sync_enabled?: boolean } | null)?.sync_enabled === true;
  if (!p.isConfigured() || !conn?.external_account_id) return NextResponse.json({ configured: p.isConfigured(), has_issuer: !!conn?.external_account_id, sync_enabled, rules: [], requests: { total: 0, ready: 0, pending: 0 }, imports, last_synced_at: conn?.last_synced_at ?? null });
  try {
    const rules = await findRules(conn.external_account_id, org.tax_id?.toUpperCase() ?? null);
    const ids = new Set(rules.all.map((r) => r.id));
    const reqs = (await p.listDownloadRequests(2)).filter((r) => r.ruleId && ids.has(r.ruleId));
    const done = new Set(imports.filter((i) => i.status === "IMPORTED").map((i) => i.provider_request_id));
    return NextResponse.json({ configured: true, has_issuer: true, sync_enabled, rules: rules.all, request_list: reqs.slice(0, 8).map((r) => ({ id: r.id, rule: rules.all.find((x) => x.id === r.ruleId)?.downloadType ?? null, status: r.status, ready: r.ready, invoice_count: r.invoiceCount, start: r.startDate, end: r.endDate, imported: done.has(r.id) })), requests: { total: reqs.length, ready: reqs.filter((r) => r.ready && !done.has(r.id)).length, pending: reqs.filter((r) => !r.ready).length }, imports, last_synced_at: conn.last_synced_at });
  } catch (e) { if (e instanceof FiscalProviderError) throw new Problem(e.code === "NOT_CONFIGURED" ? 409 : 502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
});
