/** Claves SAT de uso común (no es el catálogo completo): régimen fiscal, uso de CFDI y forma de pago. */
export const SAT_REGIMES: [string, string][] = [["601", "General de Ley Personas Morales"], ["603", "Personas Morales con Fines no Lucrativos"], ["605", "Sueldos y Salarios"], ["606", "Arrendamiento"], ["612", "Personas Físicas con Actividades Empresariales y Profesionales"], ["616", "Sin obligaciones fiscales"], ["621", "Incorporación Fiscal"], ["625", "Plataformas Tecnológicas"], ["626", "Régimen Simplificado de Confianza"]];
export const SAT_USES: [string, string][] = [["G01", "Adquisición de mercancías"], ["G02", "Devoluciones, descuentos o bonificaciones"], ["G03", "Gastos en general"], ["I01", "Construcciones"], ["I04", "Equipo de cómputo y accesorios"], ["P01", "Por definir"], ["S01", "Sin efectos fiscales"]];
export const SAT_PAYMENT_FORMS: [string, string][] = [["01", "Efectivo"], ["02", "Cheque nominativo"], ["03", "Transferencia electrónica de fondos"], ["04", "Tarjeta de crédito"], ["28", "Tarjeta de débito"], ["99", "Por definir"]];

export const satLabel = (list: [string, string][], code: string | null | undefined) => { if (!code) return null; const hit = list.find(([k]) => k === code); return hit ? `${hit[0]} · ${hit[1]}` : code; };

/** Forma de pago SAT sugerida según cómo se pagó el gasto en Procura. */
export function paymentFormFor(method: string | null | undefined): string | null {
  switch (method) { case "CASH": return "01 · Efectivo"; case "CARD": return "04 · Tarjeta de crédito (o 28 · Tarjeta de débito, según tu tarjeta)"; case "TRANSFER": return "03 · Transferencia electrónica de fondos"; case "OTHER": return "99 · Por definir"; default: return null; }
}
