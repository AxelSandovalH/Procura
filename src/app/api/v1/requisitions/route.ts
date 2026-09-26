import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { nextFolio } from "@/lib/requisitions/folio";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";
import { requisitionVisibilityWhere } from "@/lib/requisitions/visibility";
import { startApprovalRequest } from "@/lib/requisitions/approval-engine";
import type { Prisma, requisition_status, requisition_priority, requisition_type } from "@prisma/client";
import { isoDateOptional } from "@/lib/validation";

const ConceptInput = z.object({
  concept_type: z.enum(["GOOD", "SERVICE"]),
  source: z.enum(["CATALOG", "SUPPLIER_CATALOG", "FREE"]),
  catalog_item_id: z.uuid().optional(),
  supplier_catalog_item_id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  specifications: z.record(z.string(), z.unknown()).default({}),
  quantity: z.number().positive(),
  unit_id: z.uuid().optional(),
  unit_label: z.string().trim().min(1).max(40),
  estimated_unit_price_minor: z.number().int().min(0).optional(),
  budget_minor: z.number().int().min(0).optional(),
  required_date: isoDateOptional,
  location_id: z.uuid().optional(),
}).refine((c) => (c.source === "CATALOG") === !!c.catalog_item_id, { message: "catalog_item_id requerido cuando source=CATALOG" })
  .refine((c) => (c.source === "SUPPLIER_CATALOG") === !!c.supplier_catalog_item_id, { message: "supplier_catalog_item_id requerido cuando source=SUPPLIER_CATALOG" });

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  required_date: isoDateOptional,
  department_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  suggested_supplier_organization_id: z.uuid().optional(),
  directed_supplier_organization_id: z.uuid().optional(),
  destination_contact: z.string().trim().max(200).optional(),
  delivery_location_id: z.uuid().optional(),
  budget_max_minor: z.number().int().min(0).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("MXN"),
  concepts: z.array(ConceptInput).min(1),
  submit: z.boolean().default(false),
  // Origen API (OD-22): solo relevante cuando el actor es una API key.
  external_reference: z.string().trim().max(200).optional(),
});

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  const visibility = requisitionVisibilityWhere(actor);
  if (visibility === null) throw Problem.forbidden("Requiere requisition.read");

  const url = new URL(req.url);
  const sp = url.searchParams;
  const status = sp.get("status") as requisition_status | null;
  const priority = sp.get("priority") as requisition_priority | null;
  const type = sp.get("type") as requisition_type | null;
  const q = sp.get("q");

  const where: Prisma.requisitionsWhereInput = {
    ...visibility,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(type ? { requisition_type: type } : {}),
    ...(sp.get("folio") ? { folio: { contains: sp.get("folio")!, mode: "insensitive" } } : {}),
    ...(sp.get("department_id") ? { department_id: sp.get("department_id") } : {}),
    ...(sp.get("location_id") ? { location_id: sp.get("location_id") } : {}),
    ...(sp.get("requester_id") ? { requester_membership_id: sp.get("requester_id") } : {}),
    ...(sp.get("supplier_organization_id") ? { OR: [{ suggested_supplier_organization_id: sp.get("supplier_organization_id") }, { directed_supplier_organization_id: sp.get("supplier_organization_id") }] } : {}),
    ...(q ? { search_vector: { search: q.split(/\s+/).join(" & ") } } : {}),
  };

  const requisitions = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) =>
    tx.requisitions.findMany({ where, orderBy: { created_at: "desc" }, take: 100 }),
  );
  return NextResponse.json({ data: requisitions });
});

export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "requisition.create");
  const body = await json(req, (d) => Create.parse(d));

  const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const settings = await tx.organization_settings.findUniqueOrThrow({ where: { organization_id: actor.organizationId } });
    if (!settings.allow_free_concepts && body.concepts.some((c) => c.source === "FREE")) {
      throw Problem.badRequest("Esta organización no permite conceptos libres (source=FREE)");
    }
    if (settings.require_estimated_price && body.concepts.some((c) => c.estimated_unit_price_minor == null)) {
      throw Problem.badRequest("Esta organización requiere precio estimado en cada concepto");
    }
    for (const c of body.concepts) {
      if (c.catalog_item_id) {
        const item = await tx.catalog_items.findFirst({ where: { id: c.catalog_item_id, organization_id: actor.organizationId } });
        if (!item) throw Problem.badRequest(`catalog_item_id ${c.catalog_item_id} no existe en tu catálogo`);
      }
    }

    const folio = await nextFolio(tx, actor.organizationId);
    const { concepts, submit, external_reference, ...header } = body;

    const requisition = await tx.requisitions.create({
      data: {
        organization_id: actor.organizationId, folio, ...header,
        requester_membership_id: actor.type === "USER" ? actor.membershipId : null,
        origin_type: actor.type === "API_KEY" ? "API" : "MANUAL",
        origin_api_key_id: actor.type === "API_KEY" ? actor.apiKeyId : null,
        external_reference,
      },
    });
    await tx.requisition_concepts.createMany({
      data: concepts.map((c, i) => ({
        organization_id: actor.organizationId, requisition_id: requisition.id, line_number: i + 1,
        ...c, specifications: c.specifications as Prisma.InputJsonValue,
      })),
    });
    await recomputeRequisitionTotals(tx, requisition.id);
    await audit(tx, { ...auditBase(actor), action: "requisition.created", resourceType: "requisition", resourceId: requisition.id, resourceLabel: requisition.folio });

    if (submit) {
      const full = await tx.requisitions.findUniqueOrThrow({ where: { id: requisition.id } });
      const outcome = await startApprovalRequest(tx, full);
      const updated = await tx.requisitions.update({
        where: { id: requisition.id },
        data: outcome.status === "APPROVED"
          ? { status: "APPROVED", submitted_at: new Date(), approved_at: new Date(), approved_version: full.version }
          : { status: "PENDING_APPROVAL", submitted_at: new Date() },
      });
      await audit(tx, { ...auditBase(actor), action: "requisition.submitted", resourceType: "requisition", resourceId: requisition.id, resourceLabel: requisition.folio });
      if (outcome.status === "APPROVED") await audit(tx, { ...auditBase(actor), action: "requisition.approved", resourceType: "requisition", resourceId: requisition.id, resourceLabel: requisition.folio, metadata: { auto: true } });
      return updated;
    }
    return requisition;
  });

  return NextResponse.json(result, { status: 201 });
});
