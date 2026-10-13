import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { route, Problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { sanitizeFilename } from "@/lib/attachments/validate";
import { sniffReceiptFile } from "@/lib/expenses/receipt-ocr";

const MAX_BYTES = 10 * 1024 * 1024;

/** Guarda la foto del ticket o el PDF del recibo como evidencia interna del gasto (se lee con GET /attachments?anchor_type=EXPENSE&anchor_id=…). */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  await rateLimit("expense-receipt", actor.organizationId, { windowSeconds: 3600, max: 200 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw Problem.badRequest("Falta el archivo (campo 'file')");
  if (file.size > MAX_BYTES) throw Problem.badRequest("El archivo excede 10 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffReceiptFile(bytes);
  if (!mime) throw Problem.badRequest("Sube una imagen JPG, PNG o WebP, o un PDF.");
  await ensureAttachmentsBucket();
  const key = `${actor.organizationId}/${randomUUID()}`;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const up = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).upload(key, bytes, { contentType: mime, upsert: false });
  if (up.error) throw new Problem(502, "Storage no disponible", up.error.message);
  try {
    const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId }, select: { id: true, description: true } });
      if (!e) throw Problem.notFound();
      const a = await tx.attachments.create({ data: {
        owner_organization_id: actor.organizationId, uploaded_by_membership_id: actor.membershipId, anchor_type: "EXPENSE", anchor_id: e.id, visibility: "INTERNAL", kind: "EVIDENCE",
        storage_key: key, filename: sanitizeFilename(file.name || (mime === "application/pdf" ? "comprobante.pdf" : "ticket.jpg")), mime_type: mime, size_bytes: BigInt(bytes.length), checksum_sha256: checksum } });
      await audit(tx, { ...auditBase(actor), action: "attachment.uploaded", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { attachment_id: a.id, kind: "ticket" } });
      return { id: a.id, filename: a.filename, mime_type: a.mime_type, size_bytes: a.size_bytes };
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).remove([key]).catch(() => {});
    throw e;
  }
});
