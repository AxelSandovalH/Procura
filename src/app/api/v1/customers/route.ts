import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

export const CustomerBody = z.object({
  name: z.string().trim().min(1).max(200), tax_id: z.string().trim().toUpperCase().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "El RFC no tiene el formato correcto").nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(), tax_regime_code: z.string().regex(/^\d{3}$/, "El régimen son 3 dígitos").nullable().optional(),
  zip_code: z.string().regex(/^\d{5}$/, "El código postal son 5 dígitos").nullable().optional(), cfdi_use_code: z.string().regex(/^[A-Z]\d{2}$/, "El uso de CFDI es una letra y dos dígitos").nullable().optional(),
});
const Create = CustomerBody;

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.read");
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const data = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.customers.findMany({ where: { organization_id: actor.organizationId, archived_at: null, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 200 }));
  return NextResponse.json({ data });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const body = await json(req, (d) => Create.parse(d));
  const c = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const created = await tx.customers.create({ data: { organization_id: actor.organizationId, ...body } });
    await audit(tx, { ...auditBase(actor), action: "customer.created", resourceType: "customer", resourceId: created.id, resourceLabel: created.name });
    return created;
  });
  return NextResponse.json(c, { status: 201 });
});
