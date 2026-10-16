import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { idempotent } from "@/lib/http/idempotency";
import { computeSale } from "@/lib/finance/calc";
import { addPayment } from "@/lib/finance/ops";
import { saleStatuses, saleView } from "@/lib/finance/views";
import type { Prisma } from "@prisma/client";

export const LineSchema = z.object({
  description: z.string().trim().min(1).max(300), quantity: z.number().positive().max(1_000_000),
  unit_price_minor: z.number().int().min(0), discount_minor: z.number().int().min(0).default(0), tax_rate: z.number().min(0).max(1).default(0),
});
const METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
const Create = z.object({
  sold_at: z.iso.date(), customer_id: z.uuid().optional(), description: z.string().trim().min(1).max(300), currency: z.string().regex(/^[A-Z]{3}$/).default("MXN"),
  payment_method: z.enum(METHODS).optional(), notes: z.string().trim().max(2000).optional(), invoicing_flag: z.enum(["PENDING"]).optional(),
  lines: z.array(LineSchema).min(1).max(200),
  collect_now: z.boolean().default(false),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.read");
  const sp = new URL(req.url).searchParams;
  const collection = sp.get("collection_status"), invoicing = sp.get("invoicing_status"), q = sp.get("q")?.trim();
  const where: Prisma.salesWhereInput = {
    organization_id: actor.organizationId,
    ...(sp.get("customer_id") ? { customer_id: sp.get("customer_id")! } : {}),
    ...(sp.get("from") || sp.get("to") ? { sold_at: { ...(sp.get("from") ? { gte: new Date(sp.get("from")!) } : {}), ...(sp.get("to") ? { lte: new Date(sp.get("to")!) } : {}) } } : {}),
    ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { folio: { contains: q, mode: "insensitive" } }] } : {}),
  };
  // Los estados se derivan de importes: se filtran sobre la caché (collected/documented) sin traer todo.
  const AND: Prisma.salesWhereInput[] = [];
  // Las anuladas no estorban en la lista: solo salen al filtrar por «Anulada» (o con include_voided=1).
  if (collection === "VOIDED") AND.push({ voided_at: { not: null } }); else if (sp.get("include_voided") !== "1") AND.push({ voided_at: null });
  if (collection === "PENDING") AND.push({ collected_minor: 0 });
  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const list = await tx.sales.findMany({ where: { ...where, AND }, orderBy: [{ sold_at: "desc" }, { created_at: "desc" }], take: 500 });
    const cust = list.some((s) => s.customer_id) ? await tx.customers.findMany({ where: { id: { in: list.map((s) => s.customer_id).filter((x): x is string => !!x) } }, select: { id: true, name: true } }) : [];
    const names = new Map(cust.map((c) => [c.id, c.name]));
    return list.map((s) => ({ ...s, ...saleStatuses(s), customer_name: s.customer_id ? names.get(s.customer_id) ?? null : null }));
  });
  const data = rows.filter((r) => (!collection || r.collection_status === collection) && (!invoicing || r.invoicing_status === invoicing));
  return NextResponse.json({ data });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const body = await json(req, (d) => Create.parse(d));
  return idempotent(req, actor, body, async () => {
    const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      if (body.customer_id) {
        const c = await tx.customers.findFirst({ where: { id: body.customer_id, organization_id: actor.organizationId, archived_at: null }, select: { id: true } });
        if (!c) throw Problem.badRequest("El cliente no existe en tu organización");
      }
      const calc = computeSale(body.lines);
      const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`select app.next_sequence(${actor.organizationId}::uuid, 'sale') as value`;
      const sale = await tx.sales.create({ data: {
        organization_id: actor.organizationId, folio: `VTA-${value.toString().padStart(5, "0")}`, sold_at: new Date(body.sold_at), customer_id: body.customer_id, description: body.description,
        currency: body.currency, subtotal_minor: BigInt(calc.subtotal_minor), discount_minor: BigInt(calc.discount_minor), tax_minor: BigInt(calc.tax_minor), total_minor: BigInt(calc.total_minor),
        payment_method: body.payment_method, notes: body.notes, invoicing_flag: body.invoicing_flag, created_by_membership_id: actor.membershipId,
      } });
      await tx.sale_lines.createMany({ data: calc.lines.map((l) => ({ organization_id: actor.organizationId, sale_id: sale.id, line_number: l.line_number, description: l.description, quantity: l.quantity, unit_price_minor: BigInt(l.unit_price_minor), discount_minor: BigInt(l.discount_minor), tax_rate: l.tax_rate, tax_minor: BigInt(l.tax_minor), total_minor: BigInt(l.total_minor) })) });
      await audit(tx, { ...auditBase(actor), action: "sale.created", resourceType: "sale", resourceId: sale.id, resourceLabel: sale.folio, metadata: { total_minor: sale.total_minor.toString(), currency: sale.currency } });
      if (body.collect_now && calc.total_minor > 0) {
        if (!actor.permissions.has("payment.manage")) throw Problem.forbidden("Cobrar al registrar requiere payment.manage");
        const p = await addPayment(tx, actor.organizationId, actor.membershipId, "sale", sale.id, { paid_at: new Date(body.sold_at), amount_minor: calc.total_minor, method: body.payment_method });
        await audit(tx, { ...auditBase(actor), action: "payment.created", resourceType: "sale", resourceId: sale.id, resourceLabel: sale.folio, metadata: { payment_id: p.payment.id, amount_minor: calc.total_minor } });
      }
      return saleView(tx, await tx.sales.findUniqueOrThrow({ where: { id: sale.id } }));
    });
    return { status: 201, body: out };
  });
});
