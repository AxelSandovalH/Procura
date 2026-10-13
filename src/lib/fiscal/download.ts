import { randomUUID } from "node:crypto";
import { withContext } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";
import { audit } from "@/lib/audit";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { parseCfdi } from "@/lib/billing/cfdi";
import { createCfdiDocument } from "@/lib/billing/cfdi-docs";
import { FiscalProviderError, type DownloadRule } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

export interface SyncSummary { rules: number; requested: number; request_errors: string[]; imported_requests: number; pending_requests: number; created: number; duplicates: number; errors: number; last_error: string | null; time_limited: boolean }
const DAY = 86_400_000, WINDOW_DAYS = 30; // el límite del SAT es 31 días por solicitud de CFDI

const direction = (r: DownloadRule): "ISSUED" | "RECEIVED" | null => (r.downloadType === "Emitidos" ? "ISSUED" : r.downloadType === "Recibidos" ? "RECEIVED" : null);

/** Reglas de CFDI vigentes de la persona emisora de esta organización (una para emitidos y otra para recibidos). */
export async function findRules(personId: string, taxId: string | null) {
  const rules = (await getFiscalProvider().listDownloadRules()).filter((r) => (r.personId === personId || (taxId && r.tin === taxId)) && (r.queryType ?? "CFDI") === "CFDI" && (r.invoiceStatus ?? "Vigente") === "Vigente");
  return { all: rules, ISSUED: rules.find((r) => direction(r) === "ISSUED") ?? null, RECEIVED: rules.find((r) => direction(r) === "RECEIVED") ?? null };
}

/** Crea las reglas que falten (emitidos y recibidos, solo CFDI vigentes). Requiere la e.firma de la persona cargada en el proveedor. */
export async function ensureRules(personId: string, taxId: string | null) {
  const p = getFiscalProvider(); const have = await findRules(personId, taxId); const created: DownloadRule[] = [];
  if (!have.RECEIVED) created.push(await p.createDownloadRule({ personId, description: "Procura · CFDI recibidos vigentes", downloadType: "Recibidos" }));
  if (!have.ISSUED) created.push(await p.createDownloadRule({ personId, description: "Procura · CFDI emitidos vigentes", downloadType: "Emitidos" }));
  return { ...(await findRules(personId, taxId)), created };
}

async function importOne(orgId: string, membershipId: string | null, dir: "ISSUED" | "RECEIVED", mine: string | null, item: { id: string; xml: Buffer }): Promise<"CREATED" | "DUPLICATE"> {
  const cfdi = parseCfdi(item.xml);
  if (mine && (dir === "RECEIVED" ? cfdi.receiverRfc : cfdi.issuerRfc) !== mine) throw Problem.badRequest(`El CFDI ${cfdi.fiscalUuid} no corresponde al RFC de la organización (${mine}).`);
  const key = `${orgId}/cfdi/${randomUUID()}.xml`; const store = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET);
  const up = await store.upload(key, item.xml, { contentType: "text/xml", upsert: false });
  if (up.error) throw new Problem(502, "Storage no disponible", up.error.message);
  try {
    await withContext({ organizationId: orgId }, async (tx) => {
      const doc = await createCfdiDocument(tx, { organizationId: orgId, membershipId, direction: dir, cfdi, source: "PROVIDER_SYNC", files: { xmlKey: key, xmlName: `${cfdi.fiscalUuid}.xml`, pdfKey: null, pdfName: null } });
      await tx.cfdi_documents.update({ where: { id: doc.id }, data: { provider: "fiscalapi", provider_external_id: item.id, sat_status: "VIGENTE", sat_status_checked_at: new Date(), last_synced_at: new Date() } });
    });
    return "CREATED";
  } catch (e) {
    await store.remove([key]).catch(() => {});
    if (e instanceof Problem && e.status === 409) return "DUPLICATE";
    throw e;
  }
}

/**
 * Sincroniza la descarga masiva de una organización: (1) si se indica un periodo, pide al proveedor las descargas faltantes en ventanas de 30 días;
 * (2) importa las solicitudes ya listas que no se hayan importado. Es idempotente: el folio fiscal es único por organización y cada solicitud importada
 * queda registrada, así que se puede llamar cuantas veces sea (a mano o por el cron).
 */
export async function runDownloadSync(orgId: string, membershipId: string | null, opts: { from?: Date; to?: Date; budgetMs?: number } = {}): Promise<SyncSummary> {
  const started = Date.now(), budget = opts.budgetMs ?? 45_000;
  await ensureAttachmentsBucket();
  const provider = getFiscalProvider();
  const sum: SyncSummary = { rules: 0, requested: 0, request_errors: [], imported_requests: 0, pending_requests: 0, created: 0, duplicates: 0, errors: 0, last_error: null, time_limited: false };
  const conn = await withContext({ organizationId: orgId }, (tx) => tx.fiscal_provider_connections.findUnique({ where: { organization_id_provider: { organization_id: orgId, provider: provider.name } } }));
  const org = await withContext({ organizationId: orgId }, (tx) => tx.organizations.findUniqueOrThrow({ where: { id: orgId }, select: { tax_id: true } }));
  if (!conn?.external_account_id) throw new FiscalProviderError("NOT_CONFIGURED", "Falta configurar el emisor fiscal de la organización.");
  const mine = org.tax_id?.toUpperCase() ?? null;
  const rules = await findRules(conn.external_account_id, mine);
  const ours = rules.all.filter((r) => direction(r)); sum.rules = ours.length;
  if (ours.length === 0) throw new FiscalProviderError("NOT_SUPPORTED", "No hay reglas de descarga para esta persona: créalas primero (Activar descarga masiva).");

  // 1) Peticiones nuevas al proveedor (el SAT procesa y el proveedor las deja «listas» más tarde).
  if (opts.from && opts.to) {
    for (const rule of ours) {
      for (let s = opts.from.getTime(); s < opts.to.getTime(); s += WINDOW_DAYS * DAY) {
        if (Date.now() - started > budget) { sum.time_limited = true; break; }
        const e = Math.min(s + WINDOW_DAYS * DAY, opts.to.getTime());
        try { await provider.createDownloadRequest({ ruleId: rule.id, start: new Date(s), end: new Date(e) }); sum.requested++; }
        catch (err) { sum.request_errors.push(`${rule.downloadType} ${new Date(s).toISOString().slice(0, 10)}→${new Date(e).toISOString().slice(0, 10)}: ${(err as Error).message}`.slice(0, 300)); }
      }
    }
  }

  // 2) Importar lo que ya esté listo.
  const ruleById = new Map(ours.map((r) => [r.id, r]));
  const requests = (await provider.listDownloadRequests()).filter((r) => r.ruleId && ruleById.has(r.ruleId));
  const done = new Set((await withContext({ organizationId: orgId }, (tx) => tx.fiscal_sync_imports.findMany({ where: { organization_id: orgId, provider: provider.name, status: "IMPORTED" }, select: { provider_request_id: true } }))).map((x) => x.provider_request_id));
  sum.pending_requests = requests.filter((r) => !r.ready && !done.has(r.id)).length;
  for (const rq of requests.filter((r) => r.ready && !done.has(r.id))) {
    if (Date.now() - started > budget) { sum.time_limited = true; break; }
    const rule = ruleById.get(rq.ruleId!)!; const dir = direction(rule)!;
    const claimed = await withContext({ organizationId: orgId }, async (tx) => {
      const ex = await tx.fiscal_sync_imports.findUnique({ where: { organization_id_provider_provider_request_id: { organization_id: orgId, provider: provider.name, provider_request_id: rq.id } } });
      if (ex?.status === "RUNNING" && Date.now() - ex.updated_at.getTime() < 15 * 60_000) return null;
      return tx.fiscal_sync_imports.upsert({ where: { organization_id_provider_provider_request_id: { organization_id: orgId, provider: provider.name, provider_request_id: rq.id } },
        create: { organization_id: orgId, provider: provider.name, provider_request_id: rq.id, provider_rule_id: rule.id, direction: dir, status: "RUNNING" }, update: { status: "RUNNING", updated_at: new Date() } });
    });
    if (!claimed) continue;
    let created = 0, dups = 0, errors = 0, lastError: string | null = null, firstId: string | null = null;
    try {
      for (let page = 1; page <= 200; page++) {
        const { items, hasNext } = await provider.listDownloadedXml(rq.id, page);
        if (items.length === 0 || (page > 1 && items[0]!.id === firstId)) break; // el proveedor ignoró la paginación: no se repite
        firstId = firstId ?? items[0]!.id;
        for (const it of items) {
          try { if ((await importOne(orgId, membershipId, dir, mine, it)) === "CREATED") created++; else dups++; }
          catch (e) { errors++; lastError = (e instanceof Problem ? (e.detail ?? e.title) : (e as Error).message).slice(0, 300); }
        }
        if (!hasNext) break;
        if (Date.now() - started > budget) { sum.time_limited = true; throw new FiscalProviderError("UPSTREAM", "Tiempo agotado; se continuará en la siguiente sincronización."); }
      }
      sum.imported_requests++;
    } catch (e) { errors++; lastError = (e as Error).message.slice(0, 300); }
    sum.created += created; sum.duplicates += dups; sum.errors += errors; sum.last_error = lastError ?? sum.last_error;
    await withContext({ organizationId: orgId }, (tx) => tx.fiscal_sync_imports.update({ where: { id: claimed.id }, data: { status: errors === 0 ? "IMPORTED" : "PARTIAL", created_count: created, duplicate_count: dups, error_count: errors, last_error: lastError, updated_at: new Date() } }));
  }
  await withContext({ organizationId: orgId }, async (tx) => {
    await tx.fiscal_provider_connections.update({ where: { organization_id_provider: { organization_id: orgId, provider: provider.name } }, data: { last_synced_at: new Date(), last_error: sum.errors ? sum.last_error : null, updated_at: new Date() } });
    await audit(tx, { actorType: membershipId ? "USER" : "SYSTEM", membershipId, organizationId: orgId, action: "fiscal.download_synced", resourceType: "organization", resourceId: orgId, metadata: { ...sum, request_errors: sum.request_errors.length } });
  });
  return sum;
}
