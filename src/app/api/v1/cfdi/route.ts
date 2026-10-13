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
import { createCfdiDocument, materializeReceived, publicCfdi } from "@/lib/billing/cfdi-docs";
import type { Prisma } from "@prisma/client";

/** CFDI emitidos y recibidos de la organización. Filtros: direction, q (UUID, folio, nombre, RFC), from, to, unlinked=1 (nada documentado). */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.read");
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim(); const dir = sp.get("direction");
  const where: Prisma.cfdi_documentsWhereInput = {
    organization_id: actor.organizationId,
    ...(dir === "ISSUED" || dir === "RECEIVED" ? { direction: dir } : {}),
    ...(sp.get("from") || sp.get("to") ? { issued_at: { ...(sp.get("from") ? { gte: new Date(sp.get("from")!) } : {}), ...(sp.get("to") ? { lte: new Date(`${sp.get("to")}T23:59:59Z`) } : {}) } } : {}),
    ...(sp.get("unlinked") === "1" ? { allocated_minor: 0 } : {}),
    ...(q ? { OR: [{ fiscal_uuid: { contains: q, mode: "insensitive" } }, { folio: { contains: q, mode: "insensitive" } }, { issuer_name: { contains: q, mode: "insensitive" } }, { receiver_name: { contains: q, mode: "insensitive" } }, { issuer_rfc: { contains: q, mode: "insensitive" } }, { receiver_rfc: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await materializeReceived(tx, actor.organizationId, actor.membershipId); // copia propia de las facturas que los proveedores adjuntaron a sus órdenes
    return tx.cfdi_documents.findMany({ where, orderBy: [{ issued_at: "desc" }, { created_at: "desc" }], take: 300 });
  });
  return NextResponse.json({ data: rows.map((d) => ({ ...publicCfdi(d), pending_to_allocate_minor: d.total_minor - d.allocated_minor })) });
});

/** Carga manual de un CFDI (XML obligatorio, PDF opcional). La dirección se deduce comparando con el RFC de la organización. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  await rateLimit("cfdi-upload", actor.userId ?? actor.organizationId, { windowSeconds: 3600, max: 100 });
  authorize(actor, "cfdi.manage");
  const form = await req.formData();
  const xmlFile = form.get("xml"), pdfFile = form.get("pdf"), dirField = form.get("direction");
  if (!(xmlFile instanceof File)) throw Problem.badRequest("Falta el archivo XML (campo 'xml', multipart/form-data)");
  const xmlBytes = Buffer.from(await xmlFile.arrayBuffer());
  const cfdi = parseCfdi(xmlBytes);
  let pdfBytes: Buffer | null = null, pdfName: string | null = null;
  if (pdfFile instanceof File && pdfFile.size > 0) { pdfBytes = Buffer.from(await pdfFile.arrayBuffer()); pdfName = sanitizeFilename(pdfFile.name); validateFile(pdfName, "application/pdf", pdfBytes); }

  const keys: string[] = [];
  try {
    const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      const org = await tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { tax_id: true } });
      const mine = org.tax_id?.toUpperCase() ?? null;
      let direction: "ISSUED" | "RECEIVED";
      if (mine && mine === cfdi.receiverRfc) direction = "RECEIVED";
      else if (mine && mine === cfdi.issuerRfc) direction = "ISSUED";
      else if (mine) throw Problem.badRequest(`Ni el emisor (${cfdi.issuerRfc}) ni el receptor (${cfdi.receiverRfc}) del CFDI coinciden con el RFC de tu organización (${mine}).`);
      else if (dirField === "ISSUED" || dirField === "RECEIVED") direction = dirField;
      else throw Problem.badRequest("Tu organización no tiene RFC registrado: indica si el CFDI es 'ISSUED' (emitido) o 'RECEIVED' (recibido) en el campo direction, o registra tu RFC.");

      await ensureAttachmentsBucket();
      const base = `${actor.organizationId}/cfdi/${randomUUID()}`; const st = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET);
      const upX = await st.upload(`${base}.xml`, xmlBytes, { contentType: "text/xml", upsert: false }); if (upX.error) throw new Problem(502, "Storage no disponible", upX.error.message); keys.push(`${base}.xml`);
      if (pdfBytes) { const upP = await st.upload(`${base}.pdf`, pdfBytes, { contentType: "application/pdf", upsert: false }); if (upP.error) throw new Problem(502, "Storage no disponible", upP.error.message); keys.push(`${base}.pdf`); }
      const doc = await createCfdiDocument(tx, { organizationId: actor.organizationId, membershipId: actor.membershipId, direction, cfdi, source: "MANUAL_UPLOAD",
        files: { xmlKey: `${base}.xml`, xmlName: sanitizeFilename(xmlFile.name || "cfdi.xml"), pdfKey: pdfBytes ? `${base}.pdf` : null, pdfName } });
      await audit(tx, { ...auditBase(actor), action: "cfdi.uploaded", resourceType: "cfdi", resourceId: doc.id, resourceLabel: cfdi.fiscalUuid, metadata: { direction, total_minor: cfdi.totalMinor.toString(), currency: cfdi.currency } });
      return publicCfdi(doc);
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    if (keys.length) await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).remove(keys).catch(() => {});
    throw e;
  }
});
