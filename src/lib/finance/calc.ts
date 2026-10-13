import { Problem } from "@/lib/http/problem";

/** Aritmética de dinero en unidades menores (enteros): nada de decimales flotantes entre pasos. */
export interface SaleLineInput { description: string; quantity: number; unit_price_minor: number; discount_minor?: number; tax_rate?: number }
export interface SaleLineCalc extends SaleLineInput { line_number: number; discount_minor: number; tax_rate: number; gross_minor: number; tax_minor: number; total_minor: number }

export function computeLine(l: SaleLineInput, lineNumber = 1): SaleLineCalc {
  const rate = l.tax_rate ?? 0;
  const discount = l.discount_minor ?? 0;
  if (!(l.quantity > 0)) throw Problem.badRequest(`Línea ${lineNumber}: la cantidad debe ser mayor a cero`);
  if (rate < 0 || rate > 1) throw Problem.badRequest(`Línea ${lineNumber}: la tasa de impuesto debe estar entre 0 y 1 (por ejemplo 0.16)`);
  const gross = Math.round(l.quantity * l.unit_price_minor);
  if (discount > gross) throw Problem.badRequest(`Línea ${lineNumber}: el descuento no puede exceder el importe de la línea`);
  const base = gross - discount;
  const tax = Math.round(base * rate);
  return { ...l, line_number: lineNumber, discount_minor: discount, tax_rate: rate, gross_minor: gross, tax_minor: tax, total_minor: base + tax };
}

/** subtotal = importe bruto antes de descuentos; total = subtotal − descuentos + impuestos. */
export function computeSale(lines: SaleLineInput[]) {
  if (lines.length === 0) throw Problem.badRequest("La venta necesita al menos un concepto");
  const calc = lines.map((l, i) => computeLine(l, i + 1));
  const subtotal = calc.reduce((a, l) => a + l.gross_minor, 0);
  const discount = calc.reduce((a, l) => a + l.discount_minor, 0);
  const tax = calc.reduce((a, l) => a + l.tax_minor, 0);
  return { lines: calc, subtotal_minor: subtotal, discount_minor: discount, tax_minor: tax, total_minor: subtotal - discount + tax };
}

export type CollectionStatus = "PENDING" | "PARTIAL" | "COLLECTED" | "VOIDED";
export type InvoicingStatus = "NONE" | "PENDING" | "PARTIAL" | "INVOICED" | "INCIDENT";

/** Estado de cobro/pago: depende solo de los importes cobrados. Una factura no lo altera. */
export function collectionStatus(op: { total_minor: bigint | number; settled_minor: bigint | number; voided_at?: Date | null }): CollectionStatus {
  if (op.voided_at) return "VOIDED";
  const settled = Number(op.settled_minor), total = Number(op.total_minor);
  if (settled <= 0) return "PENDING";
  return settled < total ? "PARTIAL" : "COLLECTED";
}

/** Estado de facturación: depende solo de lo documentado con CFDI (y de la marca manual PENDING/INCIDENT). Un cobro no lo altera. */
export function invoicingStatus(op: { total_minor: bigint | number; documented_minor: bigint | number; invoicing_flag?: string | null }): InvoicingStatus {
  if (op.invoicing_flag === "INCIDENT") return "INCIDENT";
  const documented = Number(op.documented_minor), total = Number(op.total_minor);
  if (documented > 0 && documented >= total) return "INVOICED";
  if (documented > 0) return "PARTIAL";
  return op.invoicing_flag === "PENDING" ? "PENDING" : "NONE";
}

/** Resumen documental de una operación. `difference_minor` > 0: falta documentar; < 0: hay más documentado que el total. */
export function documentation(total: bigint | number, documented: bigint | number) {
  const t = Number(total), d = Number(documented);
  return { documented_minor: d, pending_to_document_minor: Math.max(t - d, 0), difference_minor: d > 0 ? t - d : null };
}

/** Tolerancia por redondeo al ligar CFDI: $1.00. */
export const LINK_TOLERANCE_MINOR = 100;

/** Importe que un CFDI documentará de una operación si el usuario no lo indica: lo que cabe en ambos lados. */
export function defaultAllocation(opTotal: number, opDocumented: number, cfdiTotal: number, cfdiAllocated: number): number {
  return Math.max(Math.min(opTotal - opDocumented, cfdiTotal - cfdiAllocated), 0);
}

export function assertAllocation(amount: number, opTotal: number, opDocumented: number, cfdiTotal: number, cfdiAllocated: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw Problem.badRequest("El importe a documentar debe ser mayor a cero");
  if (amount > opTotal - opDocumented + LINK_TOLERANCE_MINOR) throw Problem.badRequest("El importe excede lo que falta por documentar en la operación");
  if (amount > cfdiTotal - cfdiAllocated + LINK_TOLERANCE_MINOR) throw Problem.badRequest("El importe excede lo que le queda disponible al CFDI");
}
