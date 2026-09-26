import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { confirmReceipt } from "@/lib/fulfillment/confirm-receipt";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";

const Body = z.object({
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    delivery_line_id: z.uuid(), quantity_received: z.number().min(0), quantity_accepted: z.number().min(0), quantity_rejected: z.number().min(0),
    discrepancy_type: z.enum(["SHORTAGE", "OVERAGE", "DAMAGED", "WRONG_ITEM", "QUALITY", "OTHER"]).optional(),
    discrepancy_notes: z.string().trim().max(1000).optional(),
  })).min(1),
});

export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Body.parse(d));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const delivery = await tx.deliveries.findFirst({ where: { id: params.id, buyer_organization_id: actor.organizationId } });
    if (!delivery) throw Problem.notFound();
    authorize(actor, "receipt.confirm", { buyer_organization_id: delivery.buyer_organization_id, location_id: delivery.location_id });

    const { receipt, orderCompleted, hasDiscrepancy } = await confirmReceipt(tx, delivery.id, body, actor.membershipId);
    await audit(tx, { ...auditBase(actor), visibleTo: [delivery.buyer_organization_id, delivery.supplier_organization_id], action: "receipt.confirmed", resourceType: "receipt", resourceId: receipt.id, metadata: { has_discrepancy: hasDiscrepancy } });
    await emitEvent(tx, {
      type: "receipt.confirmed", aggregateType: "receipt", aggregateId: receipt.id, actor,
      recipients: [
        { organizationId: delivery.buyer_organization_id, perspective: "BUYER" as const, payload: { receipt: { id: receipt.id, status: receipt.status, has_discrepancy: hasDiscrepancy } } },
        { organizationId: delivery.supplier_organization_id, perspective: "SUPPLIER" as const, payload: { receipt: { id: receipt.id, status: receipt.status, has_discrepancy: hasDiscrepancy } } },
      ],
    });
    await notifyPermissionHolders(tx, { organizationId: delivery.supplier_organization_id, permission: "delivery.register", type: "receipt.confirmed", title: hasDiscrepancy ? "Recepción confirmada con discrepancias" : "Recepción confirmada", resourceType: "receipt", resourceId: receipt.id });
    if (hasDiscrepancy) await notifyPermissionHolders(tx, { organizationId: delivery.buyer_organization_id, permission: "rfq.issue", type: "receipt.confirmed", title: "Recepción con discrepancias", resourceType: "receipt", resourceId: receipt.id });
    if (orderCompleted) {
      await audit(tx, { ...auditBase(actor), visibleTo: [delivery.buyer_organization_id, delivery.supplier_organization_id], action: "order.completed", resourceType: "order", resourceId: delivery.order_id, metadata: { completion_mode: "FULL" } });
      await emitEvent(tx, { type: "order.completed", aggregateType: "order", aggregateId: delivery.order_id, actor, recipients: [{ organizationId: delivery.buyer_organization_id, perspective: "BUYER" as const, payload: { order_id: delivery.order_id } }, { organizationId: delivery.supplier_organization_id, perspective: "SUPPLIER" as const, payload: { order_id: delivery.order_id } }] });
    }
    return { receipt, order_completed: orderCompleted };
  });
  return NextResponse.json(result);
});
