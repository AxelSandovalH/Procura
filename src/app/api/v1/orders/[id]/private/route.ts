import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  const priv = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!o) throw Problem.notFound();
    return tx.order_party_private.findUnique({ where: { order_id_organization_id: { order_id: o.id, organization_id: actor.organizationId } } });
  });
  return NextResponse.json(priv ?? {});
});

const Update = z.object({
  cost_center_ref: z.string().trim().max(120).nullable().optional(),
  internal_supplier_ref: z.string().trim().max(120).nullable().optional(),
  assigned_membership_id: z.uuid().nullable().optional(),
  internal_notes: z.string().trim().max(2000).nullable().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const PUT = route(async (req, params) => {
  const actor = await requireActor(req);
  const body = await json(req, (d) => Update.parse(d));
  const updated = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const o = await tx.orders.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!o) throw Problem.notFound();
    const { custom, ...rest } = body;
    return tx.order_party_private.upsert({
      where: { order_id_organization_id: { order_id: o.id, organization_id: actor.organizationId } },
      create: { order_id: o.id, organization_id: actor.organizationId, ...rest, ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}) },
      update: { ...rest, ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}) },
    });
  });
  return NextResponse.json(updated);
});
