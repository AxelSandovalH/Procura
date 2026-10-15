import { NextResponse } from "next/server";
import { z } from "zod";
import { route, Problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { assertFeature } from "@/lib/billing/entitlements";
import { isPdf, MAX_STATEMENT_BYTES, readStatement, statementToCsv } from "@/lib/bank/statement-pdf";

export const maxDuration = 300;

/**
 * Lee el PDF de un estado de cuenta y lo devuelve como CSV (no guarda nada). El CSV se pasa después por la misma importación de siempre
 * (vista previa, duplicados y confirmación), así que reimportar el mismo periodo no duplica movimientos.
 */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  await assertFeature(actor.organizationId, "bank");
  await assertFeature(actor.organizationId, "ocr");
  await rateLimit("bank-pdf", actor.organizationId, { windowSeconds: 3600, max: 20 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) throw Problem.badRequest("Falta el PDF (campo 'file', multipart/form-data)");
  if (file.size > MAX_STATEMENT_BYTES) throw Problem.badRequest("El PDF excede 10 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isPdf(bytes)) throw Problem.badRequest("Sube el estado de cuenta en PDF.");
  if (!z.uuid().safeParse(params.id).success) throw Problem.notFound("La cuenta no existe");
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const acct = await withContext(ctx, (tx) => tx.bank_accounts.findFirst({ where: { id: params.id, organization_id: actor.organizationId, archived_at: null }, select: { id: true, name: true } }));
  if (!acct) throw Problem.notFound("La cuenta no existe");

  const s = await readStatement(bytes);
  await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "bank_account.pdf_read", resourceType: "bank_account", resourceId: acct.id, resourceLabel: acct.name, metadata: { bytes: bytes.length, movements: s.movements.length } }));
  if (!s.is_statement || s.movements.length === 0) throw Problem.badRequest("No parece un estado de cuenta con movimientos. Revisa el archivo o sube el CSV.");
  const out = statementToCsv(s);
  if (out.rows === 0) throw Problem.badRequest("No pude leer movimientos válidos del PDF. Sube el CSV del banco.");
  return NextResponse.json({ csv: out.csv, rows: out.rows, warnings: out.warnings, period: { from: s.period_start, to: s.period_end } });
});
