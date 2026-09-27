import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "@/lib/http/rate-limit";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { resolveAnchor } from "@/lib/attachments/anchor";
import { sanitizeFilename, validateFile } from "@/lib/attachments/validate";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";

const ANCHORS = ["REQUISITION", "REQUISITION_CONCEPT", "RFQ", "QUOTATION", "ORDER", "DELIVERY", "RECEIPT", "MESSAGE", "CATALOG_IMPORT"] as const;
const Meta = z.object({
  anchor_type: z.enum(ANCHORS),
  anchor_id: z.uuid(),
  visibility: z.enum(["INTERNAL", "SHARED"]).default("INTERNAL"),
  kind: z.enum(["DOCUMENT", "EVIDENCE", "IMPORT_SOURCE"]).default("DOCUMENT"),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const sp = new URL(req.url).searchParams;
  const meta = z.object({ anchor_type: z.enum(ANCHORS), anchor_id: z.uuid() }).parse({ anchor_type: sp.get("anchor_type"), anchor_id: sp.get("anchor_id") });

  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    await resolveAnchor(tx, actor, meta.anchor_type, meta.anchor_id);
    // RLS ya limita a: propios (cualquier visibilidad) + SHARED de los que soy participante.
    return tx.attachments.findMany({
      where: { anchor_type: meta.anchor_type, anchor_id: meta.anchor_id, deleted_at: null },
      orderBy: { created_at: "asc" },
      select: { id: true, filename: true, mime_type: true, size_bytes: true, kind: true, visibility: true, owner_organization_id: true, uploaded_by_membership_id: true, created_at: true },
    });
  });
  return NextResponse.json({ data: rows.map((a) => ({ ...a, mine: a.owner_organization_id === actor.organizationId })) });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  await rateLimit("attachment-upload", actor.userId ?? actor.organizationId, { windowSeconds: 3600, max: 100 });
  authorize(actor, "attachment.upload");

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw Problem.badRequest("Falta el campo 'file' (multipart/form-data)");
  const meta = Meta.parse({ anchor_type: form.get("anchor_type"), anchor_id: form.get("anchor_id"), visibility: form.get("visibility") ?? undefined, kind: form.get("kind") ?? undefined });
  if (file.size === 0) throw Problem.badRequest("El archivo está vacío");

  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = sanitizeFilename(file.name);
  validateFile(filename, file.type, bytes);

  await ensureAttachmentsBucket();
  const storageKey = `${actor.organizationId}/${randomUUID()}`;
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const attachment = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const anchor = await resolveAnchor(tx, actor, meta.anchor_type, meta.anchor_id);
    if (meta.visibility === "SHARED" && !anchor.shared) throw Problem.badRequest("Este recurso es interno: el adjunto no puede ser SHARED");

    const settings = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
    if (BigInt(bytes.length) > settings.attachment_max_bytes) throw Problem.badRequest(`El archivo excede el límite de ${Number(settings.attachment_max_bytes) / 1024 / 1024} MB`);
    const count = await tx.attachments.count({ where: { owner_organization_id: actor.organizationId, anchor_type: meta.anchor_type, anchor_id: meta.anchor_id, deleted_at: null } });
    if (count >= settings.attachment_max_per_resource) throw Problem.conflict(`Se alcanzó el máximo de ${settings.attachment_max_per_resource} adjuntos por recurso`);

    const up = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).upload(storageKey, bytes, { contentType: file.type, upsert: false });
    if (up.error) throw new Problem(502, "Storage no disponible", up.error.message);

    try {
      const created = await tx.attachments.create({
        data: {
          owner_organization_id: actor.organizationId, uploaded_by_membership_id: actor.membershipId,
          anchor_type: meta.anchor_type, anchor_id: meta.anchor_id, visibility: meta.visibility, kind: meta.kind,
          buyer_organization_id: meta.visibility === "SHARED" ? anchor.shared!.buyer : null,
          supplier_organization_id: meta.visibility === "SHARED" ? anchor.shared!.supplier : null,
          storage_key: storageKey, filename, mime_type: file.type, size_bytes: BigInt(bytes.length), checksum_sha256: checksum,
        },
      });
      await audit(tx, { ...auditBase(actor), visibleTo: meta.visibility === "SHARED" ? [anchor.shared!.buyer, anchor.shared!.supplier] : undefined, action: "attachment.uploaded", resourceType: "attachment", resourceId: created.id, resourceLabel: filename, metadata: { anchor_type: meta.anchor_type, anchor_id: meta.anchor_id, size_bytes: bytes.length } });
      return created;
    } catch (err) {
      // Si la BD falla después de subir, no dejamos un objeto huérfano en Storage.
      await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).remove([storageKey]);
      throw err;
    }
  });

  const { storage_key, storage_bucket, checksum_sha256, ...safe } = attachment;
  void storage_key; void storage_bucket; void checksum_sha256;
  return NextResponse.json(safe, { status: 201 });
});
