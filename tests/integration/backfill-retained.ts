// Lee las retenciones de los XML ya guardados (cfdi_documents.retained_minor) y recalcula lo ligado. Uso: tsx --env-file=.env.local tests/integration/backfill-retained.ts
import { prisma, withContext } from "@/lib/db/client";
import { parseCfdi } from "@/lib/billing/cfdi";
import { supabaseAdmin, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { recomputeCfdi, recomputeExpense, recomputeSale } from "@/lib/finance/ops";
async function main() {
  const orgs = await prisma().$queryRaw<{ organization_id: string }[]>`select distinct organization_id from app.orgs_with_fiscal_sync('fiscalapi')`.catch(() => []);
  void orgs;
  const all = await prisma().$queryRaw<{ id: string }[]>`select id from organizations`;
  let updated = 0;
  for (const { id: org } of all) {
    const docs = await withContext({ organizationId: org }, (tx) => tx.cfdi_documents.findMany({ where: { organization_id: org, xml_storage_key: { not: null }, retained_minor: 0 }, select: { id: true, xml_storage_key: true, fiscal_uuid: true } }));
    for (const d of docs) {
      const f = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).download(d.xml_storage_key!);
      if (f.error || !f.data) continue;
      let retained: bigint; try { retained = parseCfdi(Buffer.from(await f.data.arrayBuffer())).retainedMinor; } catch { continue; }
      if (retained <= BigInt(0)) continue;
      await withContext({ organizationId: org }, async (tx) => {
        await tx.cfdi_documents.update({ where: { id: d.id }, data: { retained_minor: retained } });
        await recomputeCfdi(tx, d.id);
        for (const l of await tx.cfdi_links.findMany({ where: { cfdi_id: d.id }, select: { sale_id: true, expense_id: true } })) { if (l.sale_id) await recomputeSale(tx, l.sale_id); if (l.expense_id) await recomputeExpense(tx, l.expense_id); }
      });
      updated++; console.log("retenciones leídas:", d.fiscal_uuid, Number(retained) / 100);
    }
  }
  console.log("CFDI actualizados:", updated); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
