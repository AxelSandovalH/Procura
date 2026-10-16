/** Tasas de las retenciones de un RESICO que le factura un servicio a una persona moral (las mismas que se timbran al emitir). */
export const RET_ISR = 0.0125, RET_IVA = 0.106667, IVA = 0.16;

export interface NetBreakdown { subtotal: number; iva: number; isr: number; ivaRet: number; net: number }
const round = (x: number) => Math.floor(x + 0.5 + 1e-9);

/** Desglose (en centavos) de un subtotal: IVA trasladado, retenciones y neto a recibir. Cada concepto se redondea como lo hace el timbrado. */
export function breakdown(subtotalMinor: number, o: { isr: boolean; ivaRet: boolean; ivaRate?: number }): NetBreakdown {
  const iva = round(subtotalMinor * (o.ivaRate ?? IVA)), isr = o.isr ? round(subtotalMinor * RET_ISR) : 0, ivaRet = o.ivaRet ? round(subtotalMinor * RET_IVA) : 0;
  return { subtotal: subtotalMinor, iva, isr, ivaRet, net: subtotalMinor + iva - isr - ivaRet };
}

/**
 * Subtotal que hay que facturar para que, después de IVA y retenciones, el cliente pague exactamente `netMinor` (en centavos).
 * Se parte de la fórmula cerrada y se afina unos centavos por el redondeo; si no hay un subtotal que dé el neto exacto, se devuelve el más cercano (`exact: false`).
 */
export function grossUpFromNet(netMinor: number, o: { isr: boolean; ivaRet: boolean; ivaRate?: number }): NetBreakdown & { exact: boolean } {
  const factor = 1 + (o.ivaRate ?? IVA) - (o.isr ? RET_ISR : 0) - (o.ivaRet ? RET_IVA : 0);
  const guess = Math.round(netMinor / factor);
  let best = breakdown(guess, o);
  for (let d = -6; d <= 6; d++) { const b = breakdown(guess + d, o); if (Math.abs(b.net - netMinor) < Math.abs(best.net - netMinor) || (Math.abs(b.net - netMinor) === Math.abs(best.net - netMinor) && Math.abs(d) < Math.abs(best.subtotal - guess))) best = b; }
  return { ...best, exact: best.net === netMinor };
}
