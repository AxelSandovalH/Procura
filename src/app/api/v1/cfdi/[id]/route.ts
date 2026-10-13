import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { publicCfdi, signedCfdiUrls } from "@/lib/billing/cfdi-docs";
import { assertFeature } from "@/lib/billing/entitlements";

/** Detalle del CFDI, a qué operaciones está ligado y URLs firmadas de corta vida (el XML nunca es público). */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.read");
  await assertFeature(actor.organizationId, "cfdi");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const d = await tx.cfdi_documents.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!d) throw Problem.notFound();
    const links = await tx.cfdi_links.findMany({ where: { cfdi_id: d.id } });
    const [sales, expenses] = await Promise.all([
      links.some((l) => l.sale_id) ? tx.sales.findMany({ where: { id: { in: links.map((l) => l.sale_id).filter((x): x is string => !!x) } }, select: { id: true, folio: true, description: true, total_minor: true } }) : [],
      links.some((l) => l.expense_id) ? tx.expenses.findMany({ where: { id: { in: links.map((l) => l.expense_id).filter((x): x is string => !!x) } }, select: { id: true, description: true, amount_minor: true } }) : [],
    ]);
    const sMap = new Map(sales.map((s) => [s.id, s])), eMap = new Map(expenses.map((e) => [e.id, e]));
    return {
      ...publicCfdi(d), pending_to_allocate_minor: d.total_minor + d.retained_minor - d.allocated_minor, downloads: await signedCfdiUrls(d),
      links: links.map((l) => ({ id: l.id, amount_minor: l.amount_minor, sale: l.sale_id ? sMap.get(l.sale_id) ?? null : null, expense: l.expense_id ? eMap.get(l.expense_id) ?? null : null })),
    };
  });
  return NextResponse.json(out);
});
