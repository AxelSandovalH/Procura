import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { parseBankCsv, withDedupeKeys } from "@/lib/bank/parse";
import { assertFeature } from "@/lib/billing/entitlements";

const Body = z.object({ csv: z.string().min(10).max(5_000_000), dry_run: z.boolean().default(false) });

/** Importa un estado de cuenta en CSV. Con dry_run solo dice qué entraría (nuevos, repetidos); reimportar el mismo archivo no duplica. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "payment.manage");
  await assertFeature(actor.organizationId, "bank");
  const body = await json(req, (d) => Body.parse(d));
  let parsed; try { parsed = parseBankCsv(body.csv); } catch (e) { throw Problem.badRequest((e as Error).message); }
  const keyed = withDedupeKeys(parsed.rows);
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const acct = await tx.bank_accounts.findFirst({ where: { id: params.id, organization_id: actor.organizationId, archived_at: null } });
    if (!acct) throw Problem.notFound("La cuenta no existe");
    const have = new Set((await tx.bank_transactions.findMany({ where: { bank_account_id: acct.id, dedupe_key: { in: keyed.map((k) => k.dedupe_key) } }, select: { dedupe_key: true } })).map((x) => x.dedupe_key));
    const fresh = keyed.filter((k) => !have.has(k.dedupe_key));
    const dates = keyed.map((k) => k.posted_at).sort();
    const summary = { total: keyed.length, new: fresh.length, duplicates: keyed.length - fresh.length, skipped: parsed.skipped, from: dates[0], to: dates[dates.length - 1], columns: parsed.columns, warnings: parsed.warnings,
      charges_minor: fresh.filter((r) => r.amount_minor < 0).reduce((s, r) => s + -r.amount_minor, 0), deposits_minor: fresh.filter((r) => r.amount_minor > 0).reduce((s, r) => s + r.amount_minor, 0), sample: fresh.slice(0, 5).map((r) => ({ posted_at: r.posted_at, description: r.description, amount_minor: r.amount_minor })) };
    if (body.dry_run || fresh.length === 0) return summary;
    await tx.bank_transactions.createMany({ data: fresh.map((r) => ({ organization_id: actor.organizationId, bank_account_id: acct.id, posted_at: new Date(r.posted_at), description: r.description, amount_minor: BigInt(r.amount_minor), balance_minor: r.balance_minor === null ? null : BigInt(r.balance_minor), reference: r.reference, dedupe_key: r.dedupe_key })), skipDuplicates: true });
    await audit(tx, { ...auditBase(actor), action: "bank_account.imported", resourceType: "bank_account", resourceId: acct.id, resourceLabel: acct.name, metadata: { imported: fresh.length, duplicates: summary.duplicates, from: summary.from, to: summary.to } });
    return summary;
  });
  return NextResponse.json(out);
});
