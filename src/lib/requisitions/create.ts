import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import { Problem } from "@/lib/http/problem";
import { audit, auditBase } from "@/lib/audit";
import { nextFolio } from "@/lib/requisitions/folio";
import { recomputeRequisitionTotals } from "@/lib/requisitions/totals";
import { submitRequisition } from "@/lib/requisitions/submit";
import { isoDateOptional } from "@/lib/validation";

export const ConceptInput = z.object({
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

export const CreateRequisition = z.object({
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

export type CreateRequisitionInput = z.infer<typeof CreateRequisition>;

/** Crea una requisición con sus conceptos (y la envía si `submit`). Compartida por `POST /requisitions` y la compra rápida. */
export async function createRequisition(tx: Tx, actor: Actor, body: CreateRequisitionInput) {
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

  if (body.directed_supplier_organization_id) {
    if (body.directed_supplier_organization_id === actor.organizationId) throw Problem.badRequest("No puedes dirigir una requisición a tu propia organización");
    const rel = await tx.relationships.findFirst({ where: { buyer_organization_id: actor.organizationId, supplier_organization_id: body.directed_supplier_organization_id, status: "ACTIVE" }, select: { id: true } });
    if (!rel) throw Problem.badRequest("Para dirigir la requisición necesitas una relación ACTIVE con ese proveedor (solicítala primero en el portal del proveedor)");
  }

  const folio = await nextFolio(tx, actor.organizationId);
  const { concepts, submit, external_reference, ...header } = body;

  const requisition = await tx.requisitions.create({
    data: {
      organization_id: actor.organizationId, folio, ...header,
      requester_membership_id: actor.type === "USER" ? actor.membershipId : null,
      origin_type: actor.type === "API_KEY" ? "API" : header.directed_supplier_organization_id ? "PORTAL" : "MANUAL",
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
    return submitRequisition(tx, actor, full);
  }
  return requisition;
}
