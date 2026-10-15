import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { readReceipt, sniffReceiptFile } from "@/lib/expenses/receipt-ocr";
import { assertFeature } from "@/lib/billing/entitlements";

export const maxDuration = 60;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Lee la foto o el PDF del ticket de una VENTA y devuelve un borrador (no guarda nada: la persona lo revisa y lo confirma).
 * Avisa si el folio del ticket ya está registrado como venta.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  await assertFeature(actor.organizationId, "ocr");
  await rateLimit("sale-scan", actor.organizationId, { windowSeconds: 3600, max: 60 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) throw Problem.badRequest("Falta la foto o el PDF (campo 'file', multipart/form-data)");
  if (file.size > MAX_BYTES) throw Problem.badRequest("El archivo excede 10 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mediaType = sniffReceiptFile(bytes);
  if (!mediaType) throw Problem.badRequest("Sube una imagen JPG, PNG o WebP, o un PDF.");
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };

  const draft = await readReceipt(bytes, mediaType);
  await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "sale.scanned", resourceType: "organization", resourceId: actor.organizationId, metadata: { media_type: mediaType, bytes: bytes.length } }));
  const folio = draft.document_number?.trim() || null;
  const existing = folio ? await withContext(ctx, (tx) => tx.sales.findMany({ where: { organization_id: actor.organizationId, folio }, select: { id: true, folio: true }, take: 3 })) : [];
  return NextResponse.json({ draft, possible_duplicates: existing });
});
