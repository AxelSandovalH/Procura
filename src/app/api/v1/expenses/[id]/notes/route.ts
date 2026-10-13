import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Body = z.object({ body: z.string().trim().min(1, "Escribe la nota").max(2000) });
const view = (n: { id: string; body: string; author_name: string; created_at: Date }) => ({ id: n.id, body: n.body, author_name: n.author_name, created_at: n.created_at.toISOString() });

/** Bitácora del gasto: notas con fecha y autor, de la más reciente a la más antigua. */
export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.read");
  const rows = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.expense_notes.findMany({ where: { expense_id: params.id, organization_id: actor.organizationId }, orderBy: { created_at: "desc" } }));
  return NextResponse.json({ data: rows.map(view) });
});

/** Agrega una nota. Las notas no se editan ni se borran. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "expense.manage");
  const { body } = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const e = await tx.expenses.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!e) throw Problem.notFound();
    const u = actor.userId ? await tx.public_users.findUnique({ where: { id: actor.userId }, select: { full_name: true, email: true } }) : null;
    const n = await tx.expense_notes.create({ data: { organization_id: actor.organizationId, expense_id: e.id, body, author_membership_id: actor.membershipId, author_name: u?.full_name || u?.email || "Integración" } });
    await audit(tx, { ...auditBase(actor), action: "expense.note_added", resourceType: "expense", resourceId: e.id, resourceLabel: e.description, metadata: { note_id: n.id } });
    return view(n);
  });
  return NextResponse.json(out, { status: 201 });
});
