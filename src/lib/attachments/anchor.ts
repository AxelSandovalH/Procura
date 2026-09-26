import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import { Problem } from "@/lib/http/problem";
import { requisitionVisibilityWhere } from "@/lib/requisitions/visibility";

export type AnchorType = "REQUISITION" | "REQUISITION_CONCEPT" | "RFQ" | "QUOTATION" | "ORDER" | "DELIVERY" | "RECEIPT" | "MESSAGE" | "CATALOG_IMPORT";

export interface ResolvedAnchor {
  /** Si el recurso es compartido entre dos organizaciones, sus ids; null si es interno de una sola. */
  shared: { buyer: string; supplier: string } | null;
}

/**
 * Resuelve el recurso al que se ancla un adjunto y comprueba que el actor pueda verlo.
 * El acceso a un adjunto hereda el del recurso (brief §26). Recurso ajeno o inexistente → 404.
 */
export async function resolveAnchor(tx: Tx, actor: Actor, type: AnchorType, id: string): Promise<ResolvedAnchor> {
  const org = actor.organizationId;
  const participant = { OR: [{ buyer_organization_id: org }, { supplier_organization_id: org }] };

  switch (type) {
    case "REQUISITION": {
      const vis = requisitionVisibilityWhere(actor);
      if (vis === null) throw Problem.notFound();
      const r = await tx.requisitions.findFirst({ where: { id, organization_id: org, ...vis }, select: { id: true } });
      if (!r) throw Problem.notFound();
      return { shared: null };
    }
    case "REQUISITION_CONCEPT": {
      const vis = requisitionVisibilityWhere(actor);
      if (vis === null) throw Problem.notFound();
      const c = await tx.requisition_concepts.findFirst({ where: { id, requisitions: { organization_id: org, ...vis } }, select: { id: true } });
      if (!c) throw Problem.notFound();
      return { shared: null };
    }
    case "CATALOG_IMPORT": {
      const i = await tx.catalog_imports.findFirst({ where: { id, organization_id: org }, select: { id: true } });
      if (!i) throw Problem.notFound();
      return { shared: null };
    }
    case "RFQ": {
      const r = await tx.quotation_requests.findFirst({ where: { id, ...participant }, select: { buyer_organization_id: true, supplier_organization_id: true } });
      if (!r) throw Problem.notFound();
      return { shared: { buyer: r.buyer_organization_id, supplier: r.supplier_organization_id } };
    }
    case "QUOTATION": {
      const q = await tx.quotations.findFirst({ where: { id, ...participant }, select: { buyer_organization_id: true, supplier_organization_id: true } });
      if (!q) throw Problem.notFound();
      return { shared: { buyer: q.buyer_organization_id, supplier: q.supplier_organization_id } };
    }
    case "ORDER": {
      const o = await tx.orders.findFirst({ where: { id, ...participant }, select: { buyer_organization_id: true, supplier_organization_id: true } });
      if (!o) throw Problem.notFound();
      return { shared: { buyer: o.buyer_organization_id, supplier: o.supplier_organization_id } };
    }
    case "DELIVERY": {
      const d = await tx.deliveries.findFirst({ where: { id, ...participant }, select: { buyer_organization_id: true, supplier_organization_id: true } });
      if (!d) throw Problem.notFound();
      return { shared: { buyer: d.buyer_organization_id, supplier: d.supplier_organization_id } };
    }
    case "RECEIPT": {
      const r = await tx.receipts.findFirst({ where: { id, ...participant }, select: { buyer_organization_id: true, supplier_organization_id: true } });
      if (!r) throw Problem.notFound();
      return { shared: { buyer: r.buyer_organization_id, supplier: r.supplier_organization_id } };
    }
    case "MESSAGE": {
      const m = await tx.messages.findFirst({ where: { id }, select: { visibility: true, organization_id: true, buyer_organization_id: true, supplier_organization_id: true } });
      if (!m) throw Problem.notFound();
      if (m.visibility === "SHARED" && m.buyer_organization_id && m.supplier_organization_id) return { shared: { buyer: m.buyer_organization_id, supplier: m.supplier_organization_id } };
      if (m.organization_id !== org) throw Problem.notFound();
      return { shared: null };
    }
  }
}
