import { describe, expect, it } from "vitest";
import { methodOf, parseSalesCsv, splitTotal, withRefs } from "@/lib/sales/import";

describe("importar ventas de un punto de venta", () => {
  it("lee tickets con folio, forma de pago y descripción; omite canceladas y devoluciones", () => {
    const r = parseSalesCsv('Folio,Fecha,Total,Forma de pago,Estatus,Producto\nT-100,12/10/2026,"1,160.00",Tarjeta de crédito,Pagada,Café\nT-101,12/10/2026,245.50,Efectivo,Pagada,\nT-102,13/10/2026,99.00,Efectivo,Cancelada,\nT-103,13/10/2026,-50.00,Efectivo,Pagada,\nx,fecha mala,10,Efectivo,Pagada,');
    expect(r.rows).toEqual([
      { sold_at: "2026-10-12", total_minor: 116000, folio: "T-100", description: "Café", method: "CARD", customer: null },
      { sold_at: "2026-10-12", total_minor: 24550, folio: "T-101", description: null, method: "CASH", customer: null }]);
    expect(r.skipped).toEqual({ invalid: 1, canceled: 1, refunds: 1 });
  });
  it("lee un corte diario (sin folio) y avisa que no podrá buscarse por folio", () => {
    const r = parseSalesCsv("Fecha;Importe\n12/10/2026;5,320.00\n13/10/2026;4,100.50");
    expect(r.rows.map((x) => [x.sold_at, x.total_minor, x.folio])).toEqual([["2026-10-12", 532000, null], ["2026-10-13", 410050, null]]);
    expect(r.warnings.join(" ")).toMatch(/folio de ticket/);
  });
  it("sin encabezado válido, error claro", () => { expect(() => parseSalesCsv("a,b\n1,2")).toThrow(/encabezado/); expect(() => parseSalesCsv("Fecha,Total\nmala,x")).toThrow(/ventas/); });
  it("formas de pago", () => { expect([methodOf("Efectivo"), methodOf("Débito"), methodOf("SPEI"), methodOf("Vales"), methodOf("")]).toEqual(["CASH", "CARD", "TRANSFER", "OTHER", null]); });
  it("las llaves distinguen folios y no funden dos ventas iguales sin folio", () => {
    const a = withRefs([{ sold_at: "2026-10-12", total_minor: 100, folio: "t-1", description: null, method: null, customer: null }, { sold_at: "2026-10-12", total_minor: 500, folio: null, description: "x", method: null, customer: null }, { sold_at: "2026-10-12", total_minor: 500, folio: null, description: "x", method: null, customer: null }]);
    expect(a[0]!.external_ref).toBe("F:T-1"); expect(a[1]!.external_ref).not.toBe(a[2]!.external_ref);
    expect(withRefs([a[1]!, a[2]!]).map((x) => x.external_ref)).toEqual([a[1]!.external_ref, a[2]!.external_ref]);
  });
  it("subtotal + IVA siempre suma EXACTAMENTE el total del ticket (para que el cliente pueda facturarlo)", () => {
    expect(splitTotal(116000, 16)).toEqual({ base: 100000, tax: 16000, exact: true }); expect(splitTotal(10000, 0)).toEqual({ base: 10000, tax: 0, exact: true });
    let exact = 0; for (let t = 100; t <= 60000; t += 7) { const s = splitTotal(t, 16); expect(s.base + s.tax).toBe(t); if (s.exact) exact++; }
    // Con 16% de IVA, cerca de 1 de cada 7 totales no tiene un subtotal en centavos exacto: ahí el IVA absorbe el centavo, pero la suma sigue siendo el total.
    expect(exact / Math.ceil((60000 - 100) / 7 + 1)).toBeGreaterThan(0.8);
    for (const t of [24550, 9999, 1, 333, 57100]) { const s = splitTotal(t, 8); expect(s.base + s.tax).toBe(t); }
  });
});
