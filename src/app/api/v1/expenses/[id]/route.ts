import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import { expenseView } from "@/lib/billing/expenses";

const Update = z.object({
  spent_at: z.iso.date().optional(),
  description: z.string().trim().min(1).max(300).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  amount_minor: z.number().int().min(0).optional(),
  supplier_name: z.string().trim().max(200).nullable().optional(),
  /** Folio fiscal (UUID) de una factura recibida solo en PDF: el XML se liga solo cuando llega por la descarga del SAT. */
  cfdi_uuid: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "El folio fiscal debe ser un UUID de 36 caracteres").nullable().optional(),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.read");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!e) throw Problem.notFound();
    return expenseView(tx, e);
  });
  return NextResponse.json(out);
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  const body = await json(req, (d) => Update.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!e) throw Problem.notFound();
    if (e.voided_at) throw Problem.conflict("El gasto está anulado");
    const { spent_at, amount_minor, cfdi_uuid, ...rest } = body;
    if (amount_minor !== undefined && BigInt(amount_minor) < e.paid_minor) throw Problem.conflict("El nuevo monto sería menor a lo ya pagado.");
    if (amount_minor !== undefined && BigInt(amount_minor) < e.documented_minor) throw Problem.conflict("El nuevo monto sería menor a lo ya documentado con CFDI.");
    const updated = await tx.expenses.update({ where: { id: e.id }, data: { ...rest, ...(cfdi_uuid !== undefined ? { cfdi_uuid_hint: cfdi_uuid ? cfdi_uuid.toUpperCase() : null } : {}), ...(spent_at ? { spent_at: new Date(spent_at) } : {}), ...(amount_minor !== undefined ? { amount_minor: BigInt(amount_minor) } : {}), updated_at: new Date() } });
    const changes = diff(e as unknown as Record<string, unknown>, { ...rest, ...(spent_at ? { spent_at: new Date(spent_at) } : {}), ...(amount_minor !== undefined ? { amount_minor: BigInt(amount_minor).toString() } : {}) });
    await audit(tx, { ...auditBase(actor), action: "expense.updated", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, changes: JSON.parse(JSON.stringify(changes)) });
    return expenseView(tx, updated);
  });
  return NextResponse.json(out);
});
