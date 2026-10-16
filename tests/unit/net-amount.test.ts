import { describe, expect, it } from "vitest";
import { breakdown, grossUpFromNet } from "@/lib/commercial/net-amount";

describe("monto neto con retenciones", () => {
  it("desglosa un subtotal de 1,800 con retenciones", () => {
    expect(breakdown(180000, { isr: true, ivaRet: true })).toEqual({ subtotal: 180000, iva: 28800, isr: 2250, ivaRet: 19200, net: 187350 });
  });
  it("para recibir 2,088.00 netos el subtotal es 2,006.09", () => {
    const g = grossUpFromNet(208800, { isr: true, ivaRet: true });
    expect(g).toMatchObject({ subtotal: 200609, iva: 32097, isr: 2508, ivaRet: 21398, net: 208800, exact: true });
  });
  it("para recibir 10,000 netos el subtotal ronda 9,607.68", () => {
    const g = grossUpFromNet(1000000, { isr: true, ivaRet: true }); expect(Math.abs(g.subtotal - 960768)).toBeLessThanOrEqual(1); expect(Math.abs(g.net - 1000000)).toBeLessThanOrEqual(1);
  });
  it("sin retenciones es solo quitar el IVA (persona física)", () => {
    expect(grossUpFromNet(232000, { isr: false, ivaRet: false })).toMatchObject({ subtotal: 200000, iva: 32000, isr: 0, ivaRet: 0, net: 232000, exact: true });
  });
  it("solo con retención de ISR", () => {
    const g = grossUpFromNet(100000, { isr: true, ivaRet: false }); expect(g.net).toBe(100000); expect(g.isr).toBe(Math.round(g.subtotal * 0.0125));
  });
  it("casi siempre da un subtotal exacto en importes redondos", () => {
    let exact = 0; for (let n = 50000; n <= 5000000; n += 12345) if (grossUpFromNet(n, { isr: true, ivaRet: true }).exact) exact++;
    expect(exact).toBeGreaterThan(300);
  });
});
