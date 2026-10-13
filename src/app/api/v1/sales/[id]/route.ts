import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { computeSale } from "@/lib/finance/calc";
import { saleView } from "@/lib/finance/views";
import { LineSchema } from "../route";

const Update = z.object({
  sold_at: z.iso.date().optional(), customer_id: z.uuid().nullable().optional(), description: z.string().trim().min(1).max(300).optional(),
  payment_method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(LineSchema).min(1).max(200).optional(),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.read");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const s = await tx.sales.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!s) throw Problem.notFound();
    return saleView(tx, s);
  });
  return NextResponse.json(out);
});

/** Editar una venta: no se puede bajar el total por debajo de lo ya cobrado o documentado. */
export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const body = await json(req, (d) => Update.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const s = await tx.sales.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!s) throw Problem.notFound();
    if (s.voided_at) throw Problem.conflict("La venta está anulada");
    if (body.customer_id) {
      const c = await tx.customers.findFirst({ where: { id: body.customer_id, organization_id: actor.organizationId, archived_at: null }, select: { id: true } });
      if (!c) throw Problem.badRequest("El cliente no existe en tu organización");
    }
    const data: Record<string, unknown> = { updated_at: new Date() };
    if (body.sold_at) data.sold_at = new Date(body.sold_at);
    for (const k of ["customer_id", "description", "payment_method", "notes"] as const) if (body[k] !== undefined) data[k] = body[k];
    if (body.lines) {
      const calc = computeSale(body.lines);
      if (BigInt(calc.total_minor) < s.collected_minor) throw Problem.conflict("El nuevo total sería menor a lo ya cobrado; anula primero el cobro correspondiente.");
      if (BigInt(calc.total_minor) < s.documented_minor) throw Problem.conflict("El nuevo total sería menor a lo ya documentado con CFDI; desliga primero el comprobante.");
      Object.assign(data, { subtotal_minor: BigInt(calc.subtotal_minor), discount_minor: BigInt(calc.discount_minor), tax_minor: BigInt(calc.tax_minor), total_minor: BigInt(calc.total_minor) });
      await tx.sale_lines.deleteMany({ where: { sale_id: s.id } });
      await tx.sale_lines.createMany({ data: calc.lines.map((l) => ({ organization_id: actor.organizationId, sale_id: s.id, line_number: l.line_number, description: l.description, quantity: l.quantity, unit_price_minor: BigInt(l.unit_price_minor), discount_minor: BigInt(l.discount_minor), tax_rate: l.tax_rate, tax_minor: BigInt(l.tax_minor), total_minor: BigInt(l.total_minor) })) });
    }
    const updated = await tx.sales.update({ where: { id: s.id }, data });
    await audit(tx, { ...auditBase(actor), action: "sale.updated", resourceType: "sale", resourceId: s.id, resourceLabel: s.folio, metadata: { fields: Object.keys(body), total_minor: updated.total_minor.toString() } });
    return saleView(tx, updated);
  });
  return NextResponse.json(out);
});
