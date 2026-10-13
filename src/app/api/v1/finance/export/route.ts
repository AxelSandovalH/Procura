import { NextResponse } from "next/server";
import JSZip from "jszip";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { assertFeature } from "@/lib/billing/entitlements";
import { rateLimit } from "@/lib/http/rate-limit";
import { supabaseAdmin, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { toCsv, day } from "@/lib/export/csv";
import { EXPORT_TYPES, MAX_ROWS, buildDataset, type ExportType } from "@/lib/export/datasets";

export const maxDuration = 60;
const MAX_XML = 150;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Exportaciones para el equipo contable: CSV (compatible con Excel) de gastos, ventas, pagos y cobros, CFDI emitidos o recibidos y movimientos bancarios,
 * y un ZIP con los XML de los CFDI del periodo. Solo lectura, de la organización activa y por rango de fechas.
 */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "finance.read");
  await assertFeature(actor.organizationId, "finance_reports");
  await rateLimit("finance-export", actor.organizationId, { windowSeconds: 600, max: 30 });
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") ?? "", from = sp.get("from") ?? "", to = sp.get("to") ?? "";
  const isZip = type === "xml_emitidos" || type === "xml_recibidos";
  if (!isZip && !(EXPORT_TYPES as readonly string[]).includes(type)) throw Problem.badRequest("Elige qué exportar.");
  if (!DATE.test(from) || !DATE.test(to) || isNaN(+new Date(from)) || isNaN(+new Date(to)) || from > to) throw Problem.badRequest("Elige un periodo válido (desde ≤ hasta).");
  const f = new Date(`${from}T00:00:00Z`), t = new Date(`${to}T00:00:00Z`);
  if (t.getTime() - f.getTime() > 400 * 86_400_000) throw Problem.badRequest("El periodo no puede exceder 400 días.");
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };

  if (isZip) {
    const dir = type === "xml_emitidos" ? "ISSUED" : "RECEIVED";
    const docs = await withContext(ctx, (tx) => tx.cfdi_documents.findMany({ where: { organization_id: actor.organizationId, direction: dir, xml_storage_key: { not: null }, issued_at: { gte: f, lt: new Date(t.getTime() + 86_400_000) } }, orderBy: { issued_at: "asc" }, take: MAX_XML + 1 }));
    if (docs.length > MAX_XML) throw Problem.badRequest(`Hay más de ${MAX_XML} CFDI en ese periodo: elige un periodo más corto para descargar los XML.`);
    if (docs.length === 0) throw Problem.notFound("No hay CFDI con XML en ese periodo.");
    const zip = new JSZip(), store = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET); const index: string[][] = [];
    for (let i = 0; i < docs.length; i += 8) {
      await Promise.all(docs.slice(i, i + 8).map(async (d) => {
        const file = await store.download(d.xml_storage_key!); if (file.error || !file.data) return;
        zip.file(`${d.fiscal_uuid}.xml`, Buffer.from(await file.data.arrayBuffer())); index.push([day(d.issued_at), d.series ?? "", d.folio ?? "", d.fiscal_uuid, d.issuer_rfc, d.receiver_rfc, String(Number(d.total_minor) / 100)]);
      }));
    }
    zip.file("indice.csv", toCsv(["Fecha", "Serie", "Folio", "UUID", "RFC del emisor", "RFC del receptor", "Total"], index.sort((a, b) => a[0]!.localeCompare(b[0]!))));
    await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "finance.exported", resourceType: "organization", resourceId: actor.organizationId, metadata: { type, from, to, files: index.length } }));
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="procura-${dir === "ISSUED" ? "xml-emitidos" : "xml-recibidos"}-${from}_${to}.zip"`, "cache-control": "no-store" } });
  }

  const ds = await withContext(ctx, async (tx) => {
    const out = await buildDataset(tx, actor.organizationId, type as ExportType, f, t);
    await audit(tx, { ...auditBase(actor), action: "finance.exported", resourceType: "organization", resourceId: actor.organizationId, metadata: { type, from, to, rows: out.rows.length, truncated: out.truncated } });
    return out;
  });
  if (ds.truncated) throw Problem.badRequest(`Hay más de ${MAX_ROWS.toLocaleString("es-MX")} filas en ese periodo: elige uno más corto.`);
  return new NextResponse(toCsv(ds.header, ds.rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${ds.filename}"`, "cache-control": "no-store", "x-rows": String(ds.rows.length) } });
});
