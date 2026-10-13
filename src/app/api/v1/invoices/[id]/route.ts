import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { publicInvoice, signedInvoiceUrls } from "@/lib/billing/invoices";

/** Detalle + URLs firmadas de corta vida para el XML y el PDF. */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "invoice.read");
  const inv = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const i = await tx.supplier_invoices.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!i) throw Problem.notFound();
    return i;
  });
  return NextResponse.json({ ...publicInvoice(inv), downloads: await signedInvoiceUrls(inv) });
});
