import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { parseSpreadsheet, previewRows } from "@/lib/catalog/parse";
import type { Prisma } from "@prisma/client";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.import");
  const imports = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.catalog_imports.findMany({ where: { organization_id: actor.organizationId }, orderBy: { created_at: "desc" }, take: 50 }),
  );
  return NextResponse.json({ data: imports });
});

/** Sube un CSV/XLSX, lo parsea y guarda cada fila cruda (sin mapear todavía) para el siguiente paso. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "catalog.import");

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw Problem.badRequest("Falta el campo 'file' (multipart/form-data)");
  if (file.size === 0) throw Problem.badRequest("El archivo está vacío");
  if (file.size > MAX_UPLOAD_BYTES) throw Problem.badRequest(`El archivo excede el límite de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw Problem.badRequest("Solo se aceptan archivos .csv o .xlsx");

  const buffer = Buffer.from(await file.arrayBuffer());
  const format = /\.xlsx$/i.test(file.name) ? "XLSX" : "CSV";
  const sheet = await parseSpreadsheet(buffer, file.name);
  if (sheet.headers.length === 0) throw Problem.badRequest("No se detectaron columnas en el archivo");
  if (sheet.rows.length === 0) throw Problem.badRequest("El archivo no tiene filas de datos");

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const imp = await tx.catalog_imports.create({
      data: {
        organization_id: actor.organizationId, format, status: "UPLOADED",
        detected_columns: sheet.headers as Prisma.InputJsonValue,
        summary: { total_rows: sheet.rows.length } as Prisma.InputJsonValue,
        created_by_membership_id: actor.membershipId,
      },
    });
    await tx.catalog_import_rows.createMany({
      data: sheet.rows.map((row, i) => ({ import_id: imp.id, organization_id: actor.organizationId, row_number: i + 1, raw: row as Prisma.InputJsonValue })),
    });
    await audit(tx, { ...auditBase(actor), action: "catalog_import.uploaded", resourceType: "catalog_import", resourceId: imp.id, resourceLabel: file.name, metadata: { rows: sheet.rows.length, format } });
    return imp;
  });

  return NextResponse.json({ id: result.id, status: result.status, detected_columns: sheet.headers, sample_rows: previewRows(sheet.rows) }, { status: 202 });
});
