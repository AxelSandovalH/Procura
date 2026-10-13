import type { Tx } from "@/lib/db/client";
import type { expenses } from "@prisma/client";
import { Problem } from "@/lib/http/problem";
import { expenseCfdi } from "@/lib/finance/views";

/** Con ERP los gastos los lleva el ERP: Procura no los registra. */
export async function assertExpensesManagedHere(tx: Tx, organizationId: string) {
  const s = await tx.organization_settings.findUnique({ where: { organization_id: organizationId }, select: { expenses_managed_by: true } });
  if (s?.expenses_managed_by === "ERP") throw Problem.conflict("Los gastos de esta organización los lleva su ERP. Procura le entrega la orden recibida y la factura ligada.");
}

/** Gasto + estados derivados (pago y facturación) + pagos + CFDI ligados con el importe que documentan. */
export async function expenseView(tx: Tx, e: expenses) {
  return { ...e, ...(await expenseCfdi(tx, e)) };
}
