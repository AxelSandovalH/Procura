import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db/client";
import { runDownloadSync } from "@/lib/fiscal/download";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { withContext } from "@/lib/db/client";
import { refreshInvoiceState } from "@/lib/billing/cancel";
import { hasFeature } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cada hora (vercel.json): importa lo que el proveedor ya dejó listo en las organizaciones con la descarga masiva activada. Protegido por CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const p = getFiscalProvider();
  if (!p.isConfigured()) return NextResponse.json({ ok: true, skipped: "proveedor fiscal sin configurar" });
  const orgs = await prisma().$queryRaw<{ organization_id: string }[]>`select * from app.orgs_with_fiscal_sync(${p.name})`;
  const started = Date.now(); const out: { org: string; created?: number; duplicates?: number; errors?: number; error?: string }[] = [];
  for (const { organization_id } of orgs) {
    if (Date.now() - started > 40_000) break;
    if (!(await hasFeature(organization_id, "sat_recovery"))) { out.push({ org: organization_id, error: "plan sin recuperación del SAT: se omite" }); continue; }
    try { const r = await runDownloadSync(organization_id, null, { budgetMs: 40_000 - (Date.now() - started) }); out.push({ org: organization_id, created: r.created, duplicates: r.duplicates, errors: r.errors }); if (r.errors) Sentry.captureMessage(`Descarga masiva con errores (${r.errors}) en ${organization_id}: ${r.last_error}`, "warning"); }
    catch (e) { out.push({ org: organization_id, error: (e as Error).message }); Sentry.captureException(e); }
  }
  // Cancelaciones en proceso: se consulta su estado hasta que el SAT las confirme o las rechace.
  const cancelling: { org: string; checked: number; error?: string }[] = [];
  for (const { organization_id } of await prisma().$queryRaw<{ organization_id: string }[]>`select * from app.orgs_with_cancelling_cfdi()`) {
    if (Date.now() - started > 50_000) break;
    try {
      const ids = await withContext({ organizationId: organization_id }, (tx) => tx.cfdi_documents.findMany({ where: { organization_id, sat_status: "CANCELANDO" }, select: { id: true }, take: 20 }));
      for (const { id } of ids) await withContext({ organizationId: organization_id }, (tx) => refreshInvoiceState(tx, organization_id, null, id)).catch((e) => Sentry.captureException(e));
      cancelling.push({ org: organization_id, checked: ids.length });
    } catch (e) { cancelling.push({ org: organization_id, checked: 0, error: (e as Error).message }); Sentry.captureException(e); }
  }
  return NextResponse.json({ ok: true, organizations: out.length, results: out, cancelling });
}
