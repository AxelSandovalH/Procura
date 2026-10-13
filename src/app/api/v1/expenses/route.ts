import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { idempotent } from "@/lib/http/idempotency";
import { assertExpensesManagedHere, expenseView } from "@/lib/billing/expenses";
import { materializeReceived } from "@/lib/billing/cfdi-docs";
import { addPayment, linkCfdi } from "@/lib/finance/ops";
import { expenseStatuses } from "@/lib/finance/views";
import type { Prisma } from "@prisma/client";

const Create = z.object({
  spent_at: z.iso.date(),
  description: z.string().trim().min(1).max(300),
  category: z.string().trim().max(80).optional(),
  amount_minor: z.number().int().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default("MXN"),
  supplier_organization_id: z.uuid().optional(),
  supplier_name: z.string().trim().max(200).optional(),
  order_id: z.uuid().optional(),
  external_reference: z.string().trim().max(200).optional(),
  cfdi_ids: z.array(z.uuid()).max(20).default([]),
  // El gasto ya se pagó: registra el pago completo con la fecha del gasto. Un ticket normalmente ya está pagado.
  paid: z.object({ method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional() }).optional(),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.read");
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  const where: Prisma.expensesWhereInput = {
    organization_id: actor.organizationId,
    ...(sp.get("include_voided") === "1" ? {} : { voided_at: null }),
    ...(sp.get("category") ? { category: sp.get("category")! } : {}),
    ...(sp.get("order_id") ? { order_id: sp.get("order_id")! } : {}),
    ...(sp.get("from") || sp.get("to") ? { spent_at: { ...(sp.get("from") ? { gte: new Date(sp.get("from")!) } : {}), ...(sp.get("to") ? { lte: new Date(sp.get("to")!) } : {}) } } : {}),
    ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { supplier_name: { contains: q, mode: "insensitive" } }, { external_reference: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const settings = await tx.organization_settings.findUnique({ where: { organization_id: actor.organizationId }, select: { expenses_managed_by: true } });
    const rows = await tx.expenses.findMany({ where, orderBy: [{ spent_at: "desc" }, { created_at: "desc" }], take: 200 });
    const links = rows.length ? await tx.cfdi_links.findMany({ where: { expense_id: { in: rows.map((r) => r.id) } }, select: { expense_id: true } }) : [];
    const counts = new Map<string, number>(); for (const l of links) counts.set(l.expense_id!, (counts.get(l.expense_id!) ?? 0) + 1);
    return { managed_by: settings?.expenses_managed_by ?? "PROCURA", rows: rows.map((r) => ({ ...r, ...expenseStatuses(r), cfdi_count: counts.get(r.id) ?? 0 })) };
  });
  return NextResponse.json({ managed_by: data.managed_by, data: data.rows });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  const body = await json(req, (d) => Create.parse(d));
  if (body.cfdi_ids.length > 0) authorize(actor, "cfdi.manage");
  if (body.paid) authorize(actor, "payment.manage");
  return idempotent(req, actor, body, async () => {
    const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      await assertExpensesManagedHere(tx, actor.organizationId);
      if (body.order_id) {
        const o = await tx.orders.findFirst({ where: { id: body.order_id, buyer_organization_id: actor.organizationId }, select: { id: true } });
        if (!o) throw Problem.badRequest("La orden no existe o no es tuya");
      }
      const { cfdi_ids, spent_at, paid, ...rest } = body;
      const e = await tx.expenses.create({ data: { ...rest, spent_at: new Date(spent_at), amount_minor: BigInt(body.amount_minor), organization_id: actor.organizationId, source: body.order_id ? "PROCURA" : "MANUAL", created_by_membership_id: actor.membershipId } });
      if (cfdi_ids.length) await materializeReceived(tx, actor.organizationId, actor.membershipId);
      if (paid && e.amount_minor > BigInt(0)) {
        const p = await addPayment(tx, actor.organizationId, actor.membershipId, "expense", e.id, { paid_at: new Date(spent_at), amount_minor: body.amount_minor, method: paid.method });
        await audit(tx, { ...auditBase(actor), action: "payment.created", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { payment_id: p.payment.id, amount_minor: body.amount_minor, method: paid.method } });
      }
      for (const id of cfdi_ids) await linkCfdi(tx, actor.organizationId, actor.membershipId, "expense", e.id, id);
      await audit(tx, { ...auditBase(actor), action: "expense.created", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { amount_minor: e.amount_minor.toString(), currency: e.currency, cfdi: cfdi_ids.length } });
      return expenseView(tx, await tx.expenses.findUniqueOrThrow({ where: { id: e.id } }));
    });
    return { status: 201, body: out };
  });
});
