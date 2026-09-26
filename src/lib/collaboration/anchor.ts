import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

export type AnchorType = "REQUISITION" | "REQUISITION_CONCEPT" | "RFQ" | "RFQ_LINE" | "QUOTATION" | "ORDER" | "DELIVERY" | "RECEIPT" | "MESSAGE" | "CATALOG_IMPORT";

export interface AnchorContext {
  /** Para anclas INTERNAL puras (requisición): la organización dueña. Null si el ancla es shared. */
  organizationId: string | null;
  buyerOrganizationId: string | null;
  supplierOrganizationId: string | null;
  relationshipId: string | null;
  allowsShared: boolean;
}

/**
 * Resuelve de quién es un ancla (comprador/proveedor de la relación, u organización dueña si es
 * puramente interna) y valida que el actor tenga visibilidad sobre ella. Un solo lugar para las
 * reglas de "quién puede ver esto" en threads/attachments — evita repetir 9 joins distintos.
 */
export async function resolveAnchor(tx: Tx, anchorType: AnchorType, anchorId: string, actorOrgId: string): Promise<AnchorContext> {
  let ctx: AnchorContext;

  switch (anchorType) {
    case "REQUISITION": {
      const r = await tx.requisitions.findUnique({ where: { id: anchorId }, select: { organization_id: true } });
      if (!r) throw Problem.notFound();
      ctx = { organizationId: r.organization_id, buyerOrganizationId: null, supplierOrganizationId: null, relationshipId: null, allowsShared: false };
      break;
    }
    case "REQUISITION_CONCEPT": {
      const c = await tx.requisition_concepts.findUnique({ where: { id: anchorId }, select: { organization_id: true } });
      if (!c) throw Problem.notFound();
      ctx = { organizationId: c.organization_id, buyerOrganizationId: null, supplierOrganizationId: null, relationshipId: null, allowsShared: false };
      break;
    }
    case "RFQ": {
      const rfq = await tx.quotation_requests.findUnique({ where: { id: anchorId }, select: { buyer_organization_id: true, supplier_organization_id: true, relationship_id: true } });
      if (!rfq) throw Problem.notFound();
      ctx = { organizationId: null, buyerOrganizationId: rfq.buyer_organization_id, supplierOrganizationId: rfq.supplier_organization_id, relationshipId: rfq.relationship_id, allowsShared: true };
      break;
    }
    case "RFQ_LINE": {
      const line = await tx.quotation_request_lines.findUnique({ where: { id: anchorId }, select: { buyer_organization_id: true, supplier_organization_id: true, quotation_requests: { select: { relationship_id: true } } } });
      if (!line) throw Problem.notFound();
      ctx = { organizationId: null, buyerOrganizationId: line.buyer_organization_id, supplierOrganizationId: line.supplier_organization_id, relationshipId: line.quotation_requests.relationship_id, allowsShared: true };
      break;
    }
    case "QUOTATION": {
      const q = await tx.quotations.findUnique({ where: { id: anchorId }, select: { buyer_organization_id: true, supplier_organization_id: true, relationship_id: true } });
      if (!q) throw Problem.notFound();
      ctx = { organizationId: null, buyerOrganizationId: q.buyer_organization_id, supplierOrganizationId: q.supplier_organization_id, relationshipId: q.relationship_id, allowsShared: true };
      break;
    }
    case "ORDER": {
      const o = await tx.orders.findUnique({ where: { id: anchorId }, select: { buyer_organization_id: true, supplier_organization_id: true, relationship_id: true } });
      if (!o) throw Problem.notFound();
      ctx = { organizationId: null, buyerOrganizationId: o.buyer_organization_id, supplierOrganizationId: o.supplier_organization_id, relationshipId: o.relationship_id, allowsShared: true };
      break;
    }
    case "DELIVERY": {
      const d = await tx.deliveries.findUnique({ where: { id: anchorId }, select: { buyer_organization_id: true, supplier_organization_id: true, relationship_id: true } });
      if (!d) throw Problem.notFound();
      ctx = { organizationId: null, buyerOrganizationId: d.buyer_organization_id, supplierOrganizationId: d.supplier_organization_id, relationshipId: d.relationship_id, allowsShared: true };
      break;
    }
    case "RECEIPT": {
      const r = await tx.receipts.findUnique({ where: { id: anchorId }, select: { buyer_organization_id: true, supplier_organization_id: true } });
      if (!r) throw Problem.notFound();
      ctx = { organizationId: null, buyerOrganizationId: r.buyer_organization_id, supplierOrganizationId: r.supplier_organization_id, relationshipId: null, allowsShared: true };
      break;
    }
    case "CATALOG_IMPORT": {
      const ci = await tx.catalog_imports.findUnique({ where: { id: anchorId }, select: { organization_id: true } });
      if (!ci) throw Problem.notFound();
      ctx = { organizationId: ci.organization_id, buyerOrganizationId: null, supplierOrganizationId: null, relationshipId: null, allowsShared: false };
      break;
    }
    case "MESSAGE": {
      // Solo válido como ancla de adjunto (archivo pegado a un mensaje), nunca de thread.
      const m = await tx.messages.findUnique({ where: { id: anchorId }, select: { organization_id: true, buyer_organization_id: true, supplier_organization_id: true, visibility: true } });
      if (!m) throw Problem.notFound();
      ctx = { organizationId: m.organization_id, buyerOrganizationId: m.buyer_organization_id, supplierOrganizationId: m.supplier_organization_id, relationshipId: null, allowsShared: m.visibility === "SHARED" };
      break;
    }
  }

  const visible = ctx.organizationId === actorOrgId || ctx.buyerOrganizationId === actorOrgId || ctx.supplierOrganizationId === actorOrgId;
  if (!visible) throw Problem.notFound();
  return ctx;
}
