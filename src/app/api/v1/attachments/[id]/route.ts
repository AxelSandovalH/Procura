import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { resolveAnchor, type AnchorType } from "@/lib/attachments/anchor";
import { supabaseAdmin } from "@/lib/supabase/admin";

const URL_TTL_SECONDS = 300;

/**
 * Metadatos + URL firmada de corta vida. Autorización en dos capas: RLS de `attachments`
 * (propio o SHARED de mi relación) y, encima, acceso al recurso ancla (brief §26).
 */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const a = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const found = await tx.attachments.findFirst({ where: { id: params.id, deleted_at: null } });
    if (!found) throw Problem.notFound();
    await resolveAnchor(tx, actor, found.anchor_type as AnchorType, found.anchor_id);
    return found;
  });

  const signed = await supabaseAdmin().storage.from(a.storage_bucket).createSignedUrl(a.storage_key, URL_TTL_SECONDS, { download: a.filename });
  if (signed.error || !signed.data) throw new Problem(502, "Storage no disponible", signed.error?.message);

  return NextResponse.json({
    id: a.id, filename: a.filename, mime_type: a.mime_type, size_bytes: a.size_bytes, kind: a.kind, visibility: a.visibility,
    anchor_type: a.anchor_type, anchor_id: a.anchor_id, mine: a.owner_organization_id === actor.organizationId, created_at: a.created_at,
    download_url: signed.data.signedUrl, download_url_expires_in: URL_TTL_SECONDS,
  });
});

/** Borrado lógico (nada se borra): solo quien lo subió, en su propia organización. El objeto de Storage se conserva. */
export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const a = await tx.attachments.findFirst({ where: { id: params.id, owner_organization_id: actor.organizationId, deleted_at: null } });
    if (!a) throw Problem.notFound();
    if (!actor.permissions.has("attachment.delete_own")) throw Problem.forbidden("Requiere attachment.delete_own");
    if (a.uploaded_by_membership_id !== actor.membershipId) throw Problem.forbidden("Solo quien subió el adjunto puede eliminarlo");
    await tx.attachments.update({ where: { id: a.id }, data: { deleted_at: new Date() } });
    await audit(tx, { ...auditBase(actor), visibleTo: a.visibility === "SHARED" && a.buyer_organization_id && a.supplier_organization_id ? [a.buyer_organization_id, a.supplier_organization_id] : undefined, action: "attachment.deleted", resourceType: "attachment", resourceId: a.id, resourceLabel: a.filename });
  });
  return new Response(null, { status: 204 });
});
