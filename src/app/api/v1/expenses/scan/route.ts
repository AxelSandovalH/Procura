import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { assertExpensesManagedHere } from "@/lib/billing/expenses";
import { readReceipt, sniffImage } from "@/lib/expenses/receipt-ocr";

export const maxDuration = 60;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Lee la foto de un ticket y devuelve un BORRADOR de gasto (no guarda nada: la persona lo revisa y lo confirma). La imagen se envía al servicio de
 * visión de Claude solo para extraer los datos; Procura no la comparte con nadie más. También avisa si ya existe un gasto igual (misma fecha e importe).
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  await rateLimit("expense-scan", actor.organizationId, { windowSeconds: 3600, max: 60 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw Problem.badRequest("Falta la foto del ticket (campo 'file', multipart/form-data)");
  if (file.size > MAX_BYTES) throw Problem.badRequest("La foto excede 8 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mediaType = sniffImage(bytes);
  if (!mediaType) throw Problem.badRequest("Sube una imagen JPG, PNG o WebP.");
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  await withContext(ctx, (tx) => assertExpensesManagedHere(tx, actor.organizationId));

  const draft = await readReceipt(bytes, mediaType);
  const duplicates = draft.total_minor !== null && draft.date
    ? await withContext(ctx, (tx) => tx.expenses.findMany({ where: { organization_id: actor.organizationId, voided_at: null, amount_minor: BigInt(draft.total_minor!), spent_at: new Date(draft.date!) }, select: { id: true, description: true, supplier_name: true }, take: 5 }))
    : [];
  return NextResponse.json({ draft, possible_duplicates: duplicates });
});
