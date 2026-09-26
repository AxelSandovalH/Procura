import type { Tx } from "@/lib/db/client";

/** Recalcula requisition_type (derivado) y estimated_total_minor a partir de los conceptos vivos. */
export async function recomputeRequisitionTotals(tx: Tx, requisitionId: string): Promise<{ requisition_type: "GOODS" | "SERVICE" | "MIXED"; estimated_total_minor: bigint }> {
  const concepts = await tx.requisition_concepts.findMany({ where: { requisition_id: requisitionId }, select: { concept_type: true, quantity: true, estimated_unit_price_minor: true } });

  const hasGood = concepts.some((c) => c.concept_type === "GOOD");
  const hasService = concepts.some((c) => c.concept_type === "SERVICE");
  const requisition_type = hasGood && hasService ? "MIXED" : hasService ? "SERVICE" : "GOODS";

  let total = BigInt(0);
  for (const c of concepts) {
    if (c.estimated_unit_price_minor == null) continue;
    total = total + BigInt(Math.round(Number(c.quantity) * Number(c.estimated_unit_price_minor)));
  }

  await tx.requisitions.update({ where: { id: requisitionId }, data: { requisition_type, estimated_total_minor: total } });
  return { requisition_type, estimated_total_minor: total };
}
