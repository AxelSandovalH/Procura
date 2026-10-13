import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase, diff } from "@/lib/audit";
import { autoPayFromXml } from "@/lib/finance/ops";
import type { Prisma } from "@prisma/client";

const Update = z.object({
  requisition_folio_prefix: z.string().trim().min(1).max(20).optional(),
  allow_free_concepts: z.boolean().optional(),
  require_estimated_price: z.boolean().optional(),
  membership_join_policy: z.enum(["INVITE_ONLY", "REQUEST_APPROVAL"]).optional(),
  relationship_request_policy: z.enum(["MANUAL_APPROVAL", "AUTO_ACCEPT_VIA_INVITATION_ONLY"]).optional(),
  requester_can_self_approve: z.boolean().optional(),
  reapproval_policy: z.enum(["ALWAYS", "IF_AMOUNT_INCREASES", "NEVER"]).optional(),
  approval_timing: z.enum(["BEFORE_QUOTING", "AFTER_QUOTING"]).optional(),
  expenses_managed_by: z.enum(["PROCURA", "ERP"]).optional(),
  expenses_paid_when_xml: z.boolean().optional(),
  auto_close_days_after_resolved: z.number().int().min(0).nullable().optional(),
  portal_enabled: z.boolean().optional(),
  portal_welcome_text: z.string().trim().max(2000).nullable().optional(),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "settings.manage");
  const settings = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } }),
  );
  return NextResponse.json(settings);
});

export const PATCH = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "settings.manage");
  const body = await json(req, (d) => Update.parse(d));

  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const { after, turnedOn } = await withContext(ctx, async (tx) => {
    const before = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
    const after = await tx.organization_settings.update({ where: { organization_id: actor.organizationId }, data: body });
    const changes = diff(before, body as Record<string, unknown>);
    if (Object.keys(changes).length > 0) await audit(tx, { ...auditBase(actor), action: "settings.updated", resourceType: "organization_settings", resourceId: actor.organizationId, changes: changes as Prisma.InputJsonValue });
    return { after, turnedOn: body.expenses_paid_when_xml === true && !before.expenses_paid_when_xml };
  });
  // Al encender la regla se aplica a lo que ya tiene CFDI (XML ligado o PDF con folio fiscal) y sigue sin pagarse. Un gasto por transacción: son muchos y una sola excede el límite.
  let backfilled = 0;
  if (turnedOn) {
    const open = await withContext(ctx, (tx) => tx.expenses.findMany({ where: { organization_id: actor.organizationId, voided_at: null, OR: [{ documented_minor: { gt: 0 } }, { cfdi_uuid_hint: { not: null } }] }, select: { id: true, amount_minor: true, paid_minor: true } }));
    for (const e of open) if (e.paid_minor < e.amount_minor && await withContext(ctx, (tx) => autoPayFromXml(tx, actor.organizationId, actor.membershipId, e.id))) backfilled++;
    if (backfilled > 0) await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "expenses.paid_by_rule_applied", resourceType: "organization_settings", resourceId: actor.organizationId, metadata: { expenses: backfilled } }));
  }
  const updated = { ...after, backfilled_expenses: backfilled };
  return NextResponse.json(updated);
});
