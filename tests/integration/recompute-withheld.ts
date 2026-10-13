// Recalcula lo retenido de las ventas ligadas a CFDI con retenciones (tras cambiar la regla de cálculo). Uso: tsx --env-file=.env.local tests/integration/recompute-withheld.ts
import { prisma, withContext } from "@/lib/db/client";
import { recomputeSale } from "@/lib/finance/ops";
async function main() {
  let n = 0;
  for (const { id: org } of await prisma().$queryRaw<{ id: string }[]>`select id from organizations`) {
    await withContext({ organizationId: org }, async (tx) => {
      const docs = await tx.cfdi_documents.findMany({ where: { organization_id: org, retained_minor: { gt: 0 } }, select: { id: true } });
      const sales = new Set((await tx.cfdi_links.findMany({ where: { cfdi_id: { in: docs.map((d) => d.id) }, sale_id: { not: null } }, select: { sale_id: true } })).map((l) => l.sale_id!));
      for (const id of sales) { const s = await recomputeSale(tx, id); console.log(s.folio, "retenido:", Number(s.withheld_minor) / 100, "cobrado:", Number(s.collected_minor) / 100); n++; }
    });
  }
  console.log("ventas recalculadas:", n); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
