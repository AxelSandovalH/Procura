import type { Tx } from "@/lib/db/client";

/** subtotal = Σ líneas no DECLINED; total = subtotal + tax (el proveedor captura el impuesto a mano, OD-17). */
export async function recomputeQuotationTotals(tx: Tx, quotationId: string) {
  const lines = await tx.quotation_lines.findMany({ where: { quotation_id: quotationId, line_kind: { not: "DECLINED" } }, select: { line_total_minor: true } });
  const subtotal = lines.reduce((acc, l) => acc + l.line_total_minor, BigInt(0));
  const current = await tx.quotations.findUniqueOrThrow({ where: { id: quotationId }, select: { tax_minor: true } });
  const total = subtotal + current.tax_minor;
  await tx.quotations.update({ where: { id: quotationId }, data: { subtotal_minor: subtotal, total_minor: total } });
  return { subtotal_minor: subtotal, total_minor: total };
}

export function computeLineTotal(quantity: number, unitPriceMinor: number): bigint {
  return BigInt(Math.round(quantity * unitPriceMinor));
}
