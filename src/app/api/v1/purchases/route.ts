import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { ConceptInput, createRequisition } from "@/lib/requisitions/create";
import { isoDateOptional } from "@/lib/validation";
import { issueRfqs } from "@/lib/sourcing/issue-rfq";

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  required_date: isoDateOptional,
  currency: z.string().regex(/^[A-Z]{3}$/).default("MXN"),
  concepts: z.array(ConceptInput).min(1),
  supplier_organization_ids: z.array(z.uuid()).max(10).default([]),
  due_days: z.number().int().min(1).max(60).default(7),
});

/**
 * Compra rápida: crea la requisición, la envía y pide cotización a los proveedores elegidos en un solo paso.
 * La emisión de RFQ exige `rfq.issue`; quien solo puede solicitar deja la requisición «por cotizar» para Compras.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.create");
  const { supplier_organization_ids, due_days, ...rest } = await json(req, (d) => Body.parse(d));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    let requisition = await createRequisition(tx, actor, { ...rest, submit: true });
    let quoted = false;
    if (supplier_organization_ids.length > 0 && actor.permissions.has("rfq.issue") && (requisition.status === "SUBMITTED" || requisition.status === "APPROVED")) {
      await issueRfqs(tx, actor, requisition.id, supplier_organization_ids, { dueDate: new Date(Date.now() + due_days * 86_400_000) });
      requisition = await tx.requisitions.findUniqueOrThrow({ where: { id: requisition.id } });
      quoted = true;
    }
    return { requisition, rfqs_issued: quoted ? supplier_organization_ids.length : 0 };
  });
  return NextResponse.json(result, { status: 201 });
});
