import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { assertExpensesManagedHere } from "@/lib/billing/expenses";
import { linkCfdi } from "@/lib/finance/ops";
import { assertFeature } from "@/lib/billing/entitlements";

const Body = z.object({ cfdi_ids: z.array(z.uuid()).min(1).max(100), category: z.string().trim().max(80).optional() });

/**
 * Crea un gasto por cada CFDI recibido y lo liga a él por el importe completo. Cada comprobante es independiente (uno que falle no
 * detiene al resto) y no se duplica: el gasto lleva como referencia externa el folio fiscal, que es único por organización.
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage"); authorize(actor, "cfdi.manage");
  await assertFeature(actor.organizationId, "cfdi");
  const body = await json(req, (d) => Body.parse(d));
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  await withContext(ctx, (tx) => assertExpensesManagedHere(tx, actor.organizationId));
  const results: { cfdi_id: string; status: "CREATED" | "SKIPPED" | "ERROR"; message?: string; expense_id?: string }[] = [];
  for (const id of [...new Set(body.cfdi_ids)]) {
    try {
      const out = await withContext(ctx, async (tx) => {
        const c = await tx.cfdi_documents.findFirst({ where: { id, organization_id: actor.organizationId } });
        if (!c) throw Problem.notFound("El CFDI no existe en tu organización");
        if (c.direction !== "RECEIVED") throw Problem.badRequest("Solo un CFDI recibido puede originar un gasto");
        if (c.cfdi_type !== "I") throw Problem.badRequest("Solo un CFDI de ingreso (tipo I) puede originar un gasto");
        if (c.sat_status === "CANCELADO") throw Problem.badRequest("El CFDI está cancelado");
        if (c.allocated_minor > BigInt(0)) return { skipped: "Ya documenta un gasto" } as const;
        const ref = `CFDI:${c.fiscal_uuid.toUpperCase()}`;
        const exists = await tx.expenses.findFirst({ where: { organization_id: actor.organizationId, external_reference: ref }, select: { id: true } });
        if (exists) return { skipped: "Ya existe un gasto creado desde este CFDI" } as const;
        const label = [c.series, c.folio].filter(Boolean).join("-");
        const e = await tx.expenses.create({ data: {
          organization_id: actor.organizationId, spent_at: new Date((c.issued_at ?? c.created_at).toISOString().slice(0, 10)), description: `${c.issuer_name ?? c.issuer_rfc}${label ? ` · ${label}` : ""}`,
          category: body.category, amount_minor: c.total_minor, currency: c.currency, supplier_name: c.issuer_name ?? c.issuer_rfc, source: "MANUAL", external_reference: ref, created_by_membership_id: actor.membershipId } });
        await linkCfdi(tx, actor.organizationId, actor.membershipId, "expense", e.id, c.id);
        await audit(tx, { ...auditBase(actor), action: "expense.created", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { from_cfdi: c.id, fiscal_uuid: c.fiscal_uuid, amount_minor: c.total_minor.toString() } });
        return { expense_id: e.id } as const;
      });
      results.push("skipped" in out ? { cfdi_id: id, status: "SKIPPED", message: out.skipped } : { cfdi_id: id, status: "CREATED", expense_id: out.expense_id });
    } catch (e) { results.push({ cfdi_id: id, status: "ERROR", message: e instanceof Problem ? (e.detail ?? e.title) : "Error inesperado." }); }
  }
  const n = (s: string) => results.filter((r) => r.status === s).length;
  return NextResponse.json({ summary: { created: n("CREATED"), skipped: n("SKIPPED"), errors: n("ERROR") }, results });
});
