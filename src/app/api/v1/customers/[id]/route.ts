import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { CustomerBody } from "../route";

const Patch = CustomerBody.partial().extend({ archived: z.boolean().optional() });

/** Edita los datos fiscales de un cliente (para facturarle) o lo archiva. Los clientes archivados no se borran: sus ventas y facturas se conservan. */
export const PATCH = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage");
  const { archived, ...body } = await json(req, (d) => Patch.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const c = await tx.customers.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
    if (!c) throw Problem.notFound();
    const u = await tx.customers.update({ where: { id: c.id }, data: { ...body, ...(archived === undefined ? {} : { archived_at: archived ? new Date() : null }), updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: archived ? "customer.archived" : "customer.updated", resourceType: "customer", resourceId: u.id, resourceLabel: u.name, metadata: { fields: Object.keys(body) } });
    return u;
  });
  return NextResponse.json(out);
});
