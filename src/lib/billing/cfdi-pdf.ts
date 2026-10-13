import { withContext } from "@/lib/db/client";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { Problem } from "@/lib/http/problem";
import { FiscalProviderError } from "@/lib/fiscal/provider";

export interface StoredPdf { key: string; filename: string; buffer: Buffer }

/** Pide el PDF al proveedor y lo guarda junto al XML (una sola vez: después se sirve desde Storage). Solo CFDI emitidos por el proveedor actual. */
export async function generateAndStorePdf(organizationId: string, cfdiId: string): Promise<StoredPdf> {
  const provider = getFiscalProvider();
  const d = await withContext({ organizationId }, (tx) => tx.cfdi_documents.findFirst({ where: { id: cfdiId, organization_id: organizationId } }));
  if (!d) throw Problem.notFound();
  if (d.direction !== "ISSUED" || !d.provider_external_id || d.provider !== provider.name) throw Problem.conflict("Este CFDI no se emitió desde Procura: su PDF no se puede generar aquí.");
  let buffer: Buffer;
  try { buffer = await provider.invoicePdf(d.provider_external_id); }
  catch (e) { if (e instanceof FiscalProviderError) throw new Problem(502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
  await ensureAttachmentsBucket();
  const key = `${organizationId}/cfdi/${d.fiscal_uuid}.pdf`, filename = `${d.fiscal_uuid}.pdf`;
  const up = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).upload(key, buffer, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Problem(502, "Storage no disponible", up.error.message);
  await withContext({ organizationId }, (tx) => tx.cfdi_documents.update({ where: { id: d.id }, data: { pdf_storage_key: key, pdf_filename: filename, updated_at: new Date() } }));
  return { key, filename, buffer };
}

/** Igual, pero sin lanzar: una factura ya timbrada no debe fallar porque el PDF tarde o el proveedor no responda (se puede generar después). */
export async function tryGeneratePdf(organizationId: string, cfdiId: string): Promise<StoredPdf | null> {
  try { return await generateAndStorePdf(organizationId, cfdiId); } catch (e) { console.warn("[cfdi-pdf] no se generó el PDF:", e instanceof Error ? e.message : e); return null; }
}
