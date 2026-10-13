import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { route, Problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { sanitizeFilename, validateFile } from "@/lib/attachments/validate";
import { parseCfdi } from "@/lib/billing/cfdi";
import { createCfdiDocument } from "@/lib/billing/cfdi-docs";
import { baseName, collectCfdiFiles } from "@/lib/billing/cfdi-bulk";

type Result = { file: string; status: "CREATED" | "DUPLICATE" | "ERROR" | "IGNORED"; message?: string; cfdi_id?: string; fiscal_uuid?: string; direction?: string; total_minor?: string; currency?: string };

/**
 * Carga masiva: varios XML (y sus PDF, emparejados por nombre) sueltos o dentro de un ZIP. Cada comprobante se procesa por separado:
 * uno inválido o repetido no detiene a los demás, y la respuesta dice qué pasó con cada archivo.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  await rateLimit("cfdi-bulk", actor.userId ?? actor.organizationId, { windowSeconds: 3600, max: 20 });
  authorize(actor, "cfdi.manage");
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw Problem.badRequest("Sube al menos un archivo XML o ZIP (campo 'files', multipart/form-data)");
  if (files.length > 300) throw Problem.badRequest("Demasiados archivos en una sola carga");
  const dirField = form.get("direction");
  const { xml, pdf, notes } = await collectCfdiFiles(files);
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const mine = (await withContext(ctx, (tx) => tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { tax_id: true } }))).tax_id?.toUpperCase() ?? null;
  const forced = dirField === "ISSUED" || dirField === "RECEIVED" ? dirField : null;
  await ensureAttachmentsBucket();
  const store = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET);
  const results: Result[] = notes.map((n) => ({ file: n.file, status: "IGNORED" as const, message: n.message }));

  for (const x of xml) {
    const keys: string[] = [];
    try {
      const cfdi = parseCfdi(x.bytes);
      let direction: "ISSUED" | "RECEIVED";
      if (mine && mine === cfdi.receiverRfc) direction = "RECEIVED";
      else if (mine && mine === cfdi.issuerRfc) direction = "ISSUED";
      else if (mine) throw Problem.badRequest(`Ni el emisor (${cfdi.issuerRfc}) ni el receptor (${cfdi.receiverRfc}) coinciden con el RFC de tu organización (${mine}).`);
      else if (forced) direction = forced;
      else throw Problem.badRequest("Tu organización no tiene RFC registrado: regístralo o indica si son emitidos o recibidos.");

      const base = `${actor.organizationId}/cfdi/${randomUUID()}`;
      const upX = await store.upload(`${base}.xml`, x.bytes, { contentType: "text/xml", upsert: false });
      if (upX.error) throw new Problem(502, "Storage no disponible", upX.error.message);
      keys.push(`${base}.xml`);
      const p = pdf.get(baseName(x.name)); let pdfKey: string | null = null, pdfName: string | null = null;
      if (p) { try { pdfName = sanitizeFilename(p.name.split(/[\\/]/).pop() ?? "factura.pdf"); validateFile(pdfName, "application/pdf", p.bytes); const upP = await store.upload(`${base}.pdf`, p.bytes, { contentType: "application/pdf", upsert: false }); if (!upP.error) { pdfKey = `${base}.pdf`; keys.push(pdfKey); } } catch { pdfName = null; } }
      const doc = await withContext(ctx, async (tx) => {
        const d = await createCfdiDocument(tx, { organizationId: actor.organizationId, membershipId: actor.membershipId, direction, cfdi, source: "MANUAL_UPLOAD",
          files: { xmlKey: `${base}.xml`, xmlName: sanitizeFilename(x.name.split(/[\\/]/).pop() ?? "cfdi.xml"), pdfKey, pdfName } });
        await audit(tx, { ...auditBase(actor), action: "cfdi.uploaded", resourceType: "cfdi", resourceId: d.id, resourceLabel: cfdi.fiscalUuid, metadata: { direction, bulk: true, total_minor: cfdi.totalMinor.toString(), currency: cfdi.currency } });
        return d;
      });
      results.push({ file: x.name, status: "CREATED", cfdi_id: doc.id, fiscal_uuid: cfdi.fiscalUuid, direction, total_minor: cfdi.totalMinor.toString(), currency: cfdi.currency });
    } catch (e) {
      if (keys.length) await store.remove(keys).catch(() => {});
      const dup = e instanceof Problem && e.status === 409;
      results.push({ file: x.name, status: dup ? "DUPLICATE" : "ERROR", message: e instanceof Problem ? (e.detail ?? e.title) : "Error inesperado al procesar el archivo." });
    }
  }
  const count = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  return NextResponse.json({ summary: { created: count("CREATED"), duplicates: count("DUPLICATE"), errors: count("ERROR"), ignored: count("IGNORED") }, results }, { status: 200 });
});
