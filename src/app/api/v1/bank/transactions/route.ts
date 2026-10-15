import { NextResponse } from "next/server";
import { route } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { loadCandidates, loadForeignExpenses } from "@/lib/bank/ops";
import { suggest, suggestForeign } from "@/lib/bank/match";
import { assertFeature } from "@/lib/billing/entitlements";

/** Movimientos de una cuenta por estado; los que faltan por conciliar traen sugerencias. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "finance.read");
  await assertFeature(actor.organizationId, "bank");
  const sp = new URL(req.url).searchParams;
  const accountId = sp.get("account_id"); const status = ["UNMATCHED", "MATCHED", "IGNORED"].includes(sp.get("status") ?? "") ? sp.get("status")! : "UNMATCHED";
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const acct = accountId ? await tx.bank_accounts.findFirst({ where: { id: accountId, organization_id: actor.organizationId } }) : null;
    if (!acct) return [];
    const rows = await tx.bank_transactions.findMany({ where: { organization_id: actor.organizationId, bank_account_id: acct.id, status }, orderBy: [{ posted_at: "desc" }, { created_at: "desc" }], take: 200 });
    const cand = status === "UNMATCHED" && rows.length ? { out: await loadCandidates(tx, actor.organizationId, acct.currency, true), inn: await loadCandidates(tx, actor.organizationId, acct.currency, false), foreign: await loadForeignExpenses(tx, actor.organizationId, acct.currency) } : null;
    return rows.map((r) => {
      const t = { id: r.id, posted_at: r.posted_at.toISOString().slice(0, 10), description: r.description, amount_minor: Number(r.amount_minor), balance_minor: r.balance_minor === null ? null : Number(r.balance_minor), reference: r.reference, status: r.status, payment_id: r.payment_id, currency: acct.currency };
      return { ...t, suggestions: cand ? (r.amount_minor < BigInt(0) ? [...suggest(t, cand.out), ...suggestForeign(t, acct.currency, cand.foreign)] : suggest(t, cand.inn)) : [] };
    });
  });
  return NextResponse.json({ data });
});
