import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

/** Estado real del proveedor fiscal: qué está configurado y qué capacidades están realmente implementadas. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.read");
  const p = getFiscalProvider();
  const connection = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.fiscal_provider_connections.findUnique({ where: { organization_id_provider: { organization_id: actor.organizationId, provider: p.name } } }));
  return NextResponse.json({ provider: p.name, configured: p.isConfigured(), environment: p.isConfigured() ? p.environment() : null, capabilities: p.capabilities, notes: p.notes, connection: connection ? { status: connection.status, last_synced_at: connection.last_synced_at, last_error: connection.last_error, external_account_id: connection.external_account_id, settings: connection.settings } : null });
});
