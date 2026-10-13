import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { publicInvoice } from "@/lib/billing/invoices";
import type { Prisma, supplier_invoice_status } from "@prisma/client";

/** Facturas recibidas (comprador) o enviadas (proveedor) de la organización activa. Filtros: status, order_id, supplier_organization_id, unlinked=1 (sin gasto ligado). */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "invoice.read");
  const sp = new URL(req.url).searchParams;
  const where: Prisma.supplier_invoicesWhereInput = {
    OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }],
    ...(sp.get("status") ? { status: sp.get("status") as supplier_invoice_status } : {}),
    ...(sp.get("order_id") ? { order_id: sp.get("order_id")! } : {}),
    ...(sp.get("supplier_organization_id") ? { supplier_organization_id: sp.get("supplier_organization_id")! } : {}),
  };
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    let rows = await tx.supplier_invoices.findMany({ where, orderBy: { created_at: "desc" }, take: 200 });
    const links = rows.length ? await tx.expense_invoices.findMany({ where: { supplier_invoice_id: { in: rows.map((r) => r.id) } }, select: { supplier_invoice_id: true, expense_id: true } }) : [];
    const linked = new Map<string, string[]>();
    for (const l of links) linked.set(l.supplier_invoice_id, [...(linked.get(l.supplier_invoice_id) ?? []), l.expense_id]);
    if (sp.get("unlinked") === "1") rows = rows.filter((r) => !linked.has(r.id) && r.status !== "REJECTED");
    return rows.map((r) => ({ ...publicInvoice(r), expense_ids: linked.get(r.id) ?? [] }));
  });
  return NextResponse.json({ data });
});
