import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";

/**
 * Consumo del mes de los servicios con costo variable, SEPARADO por concepto y por RFC de la organización:
 * emisión (timbrado), recuperación de CFDI del SAT y lecturas de tickets (OCR). Solo cuenta; no calcula montos porque las tarifas del proveedor no se conocen con certeza.
 */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "settings.manage");
  const month = new URL(req.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Problem.badRequest("El mes va como AAAA-MM");
  const from = new Date(`${month}-01T00:00:00Z`), to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const org = actor.organizationId;
  const out = await withContext({ userId: actor.userId, organizationId: org }, async (tx) => {
    const [o, issue, imports, scans] = await Promise.all([
      tx.organizations.findUniqueOrThrow({ where: { id: org }, select: { tax_id: true } }),
      tx.fiscal_issue_requests.groupBy({ by: ["status", "source"], where: { organization_id: org, created_at: { gte: from, lt: to } }, _count: true }),
      tx.fiscal_sync_imports.findMany({ where: { organization_id: org, updated_at: { gte: from, lt: to } }, select: { direction: true, status: true, created_count: true, duplicate_count: true, error_count: true } }),
      tx.audit_logs.count({ where: { organization_id: org, action: "expense.scanned", occurred_at: { gte: from, lt: to } } }),
    ]);
    const n = (status: string, source?: string) => issue.filter((g) => g.status === status && (!source || g.source === source)).reduce((s, g) => s + g._count, 0);
    return {
      month, rfc: o.tax_id,
      emission: { stamped: n("DONE"), failed: n("FAILED"), in_progress: n("PENDING"), by_source: { app: n("DONE", "USER"), public_portal: n("DONE", "PORTAL") } },
      sat_recovery: { provider_requests_imported: imports.filter((i) => i.status === "IMPORTED").length, provider_requests_retrying: imports.filter((i) => i.status === "PARTIAL").length, cfdi_new: imports.reduce((s, i) => s + i.created_count, 0), cfdi_already_had: imports.reduce((s, i) => s + i.duplicate_count, 0), errors: imports.reduce((s, i) => s + i.error_count, 0) },
      ocr: { scans },
      note: "Son conteos: el costo en pesos depende de las tarifas del proveedor (ver docs/PRICING.md). La emisión y la recuperación del SAT son servicios distintos y no se suman.",
    };
  });
  return NextResponse.json(out);
});
