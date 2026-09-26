import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import type { order_status } from "@prisma/client";

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  if (!actor.permissions.has("order.read")) throw Problem.forbidden();
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as order_status | null;
  const position = sp.get("position");
  const counterpart = sp.get("counterpart_organization_id");

  const orders = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.orders.findMany({
      where: {
        ...(position === "BUYER" ? { buyer_organization_id: actor.organizationId } : position === "SUPPLIER" ? { supplier_organization_id: actor.organizationId } : { OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] }),
        ...(status ? { status } : {}),
        ...(counterpart ? { OR: [{ buyer_organization_id: counterpart }, { supplier_organization_id: counterpart }] } : {}),
      },
      orderBy: { created_at: "desc" }, take: 100,
      include: {
        organizations_orders_buyer_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
        organizations_orders_supplier_organization_idToorganizations: { select: { id: true, slug: true, display_name: true } },
      },
    }),
  );
  return NextResponse.json({
    data: orders.map((o) => ({
      id: o.id, order_number: o.order_number, status: o.status, currency: o.currency, total_minor: o.total_minor,
      perspective: o.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER",
      buyer: o.organizations_orders_buyer_organization_idToorganizations, supplier: o.organizations_orders_supplier_organization_idToorganizations,
      created_at: o.created_at,
    })),
  });
});
