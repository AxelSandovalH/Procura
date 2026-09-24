import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Update = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  role_label: z.string().trim().max(80).nullable().optional(),
  is_primary: z.boolean().optional(),
});

export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");
  const body = await json(req, (d) => Update.parse(d));

  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const before = await tx.relationship_contacts.findFirst({ where: { id: params.cid, relationship_id: params.id, organization_id: actor.organizationId } });
    if (!before) throw Problem.notFound();
    if (body.is_primary) await tx.relationship_contacts.updateMany({ where: { relationship_id: params.id, organization_id: actor.organizationId, is_primary: true, id: { not: params.cid } }, data: { is_primary: false } });
    const after = await tx.relationship_contacts.update({ where: { id: params.cid }, data: body });
    await audit(tx, { ...auditBase(actor), action: "relationship_contact.updated", resourceType: "relationship_contact", resourceId: after.id, resourceLabel: after.name });
    return after;
  });
  return NextResponse.json(updated);
});

export const DELETE = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");
  await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const contact = await tx.relationship_contacts.findFirst({ where: { id: params.cid, relationship_id: params.id, organization_id: actor.organizationId } });
    if (!contact) throw Problem.notFound();
    await tx.relationship_contacts.delete({ where: { id: params.cid } });
    await audit(tx, { ...auditBase(actor), action: "relationship_contact.deleted", resourceType: "relationship_contact", resourceId: contact.id, resourceLabel: contact.name });
  });
  return new Response(null, { status: 204 });
});
