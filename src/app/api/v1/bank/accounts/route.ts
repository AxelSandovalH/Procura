import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { assertFeature } from "@/lib/billing/entitlements";

const Create = z.object({ name: z.string().trim().min(1, "Ponle un nombre a la cuenta").max(80), bank: z.string().trim().max(80).nullable().optional(), currency: z.string().length(3).default("MXN"), last4: z.string().regex(/^\d{4}$/, "Solo los últimos 4 dígitos").nullable().optional() });

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "finance.read");
  await assertFeature(actor.organizationId, "bank");
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const accounts = await tx.bank_accounts.findMany({ where: { organization_id: actor.organizationId, archived_at: null }, orderBy: { created_at: "asc" } });
    const groups = await tx.bank_transactions.groupBy({ by: ["bank_account_id", "status"], where: { organization_id: actor.organizationId }, _count: true });
    return accounts.map((a) => ({ ...a, unmatched: groups.find((g) => g.bank_account_id === a.id && g.status === "UNMATCHED")?._count ?? 0, matched: groups.find((g) => g.bank_account_id === a.id && g.status === "MATCHED")?._count ?? 0 }));
  });
  return NextResponse.json({ data });
});

/** Registra una cuenta bancaria: nombre, banco, moneda y últimos 4 dígitos. Nunca números completos ni credenciales. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  await assertFeature(actor.organizationId, "bank");
  const body = await json(req, (d) => Create.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const a = await tx.bank_accounts.create({ data: { ...body, currency: body.currency.toUpperCase(), organization_id: actor.organizationId } });
    await audit(tx, { ...auditBase(actor), action: "bank_account.created", resourceType: "bank_account", resourceId: a.id, resourceLabel: a.name });
    return a;
  });
  return NextResponse.json(out, { status: 201 });
});
