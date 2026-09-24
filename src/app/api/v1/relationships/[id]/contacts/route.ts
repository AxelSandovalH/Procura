import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().optional(),
  phone: z.string().trim().max(40).optional(),
  role_label: z.string().trim().max(80).optional(),
  membership_id: z.uuid().optional(),
  is_primary: z.boolean().default(false),
});

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.read");
  const contacts = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] }, select: { id: true } });
    if (!r) throw Problem.notFound();
    return tx.relationship_contacts.findMany({ where: { relationship_id: r.id }, orderBy: [{ organization_id: "asc" }, { is_primary: "desc" }] });
  });
  return NextResponse.json({ data: contacts });
});

/** Cada organización solo puede crear contactos de su propio lado de la relación. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "relationship.manage");
  const body = await json(req, (d) => Create.parse(d));

  const contact = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const r = await tx.relationships.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!r) throw Problem.notFound();
    if (body.membership_id) {
      const m = await tx.memberships.findFirst({ where: { id: body.membership_id, organization_id: actor.organizationId, status: "ACTIVE" } });
      if (!m) throw Problem.badRequest("membership_id no es un miembro activo de tu organización");
    }
    if (body.is_primary) await tx.relationship_contacts.updateMany({ where: { relationship_id: r.id, organization_id: actor.organizationId, is_primary: true }, data: { is_primary: false } });
    const created = await tx.relationship_contacts.create({
      data: { relationship_id: r.id, buyer_organization_id: r.buyer_organization_id, supplier_organization_id: r.supplier_organization_id, organization_id: actor.organizationId, ...body },
    });
    await audit(tx, { ...auditBase(actor), action: "relationship_contact.created", resourceType: "relationship_contact", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(contact, { status: 201 });
});
