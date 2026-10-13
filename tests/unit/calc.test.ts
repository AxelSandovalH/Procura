import { describe, expect, it } from "vitest";
import { assertAllocation, collectionStatus, computeSale, defaultAllocation, documentation, invoicingStatus } from "@/lib/finance/calc";

describe("cálculo de ventas", () => {
  it("calcula subtotal, descuento, IVA y total por línea y en conjunto", () => {
    const r = computeSale([
      { description: "Tacos", quantity: 3, unit_price_minor: 5000, tax_rate: 0.16 },                       // 15000 + 2400
      { description: "Refresco", quantity: 2, unit_price_minor: 2500, discount_minor: 500, tax_rate: 0.16 }, // 5000 - 500 = 4500 + 720
    ]);
    expect(r.subtotal_minor).toBe(20000);
    expect(r.discount_minor).toBe(500);
    expect(r.tax_minor).toBe(3120);
    expect(r.total_minor).toBe(20000 - 500 + 3120);
  });
  it("redondea el impuesto por línea a centavos enteros", () => {
    const r = computeSale([{ description: "x", quantity: 1, unit_price_minor: 333, tax_rate: 0.16 }]);
    expect(r.tax_minor).toBe(53); // 53.28 → 53
    expect(Number.isInteger(r.total_minor)).toBe(true);
  });
  it("rechaza descuentos mayores al importe, cantidades no positivas, tasas fuera de rango y ventas sin conceptos", () => {
    expect(() => computeSale([{ description: "x", quantity: 1, unit_price_minor: 100, discount_minor: 101 }])).toThrow();
    expect(() => computeSale([{ description: "x", quantity: 0, unit_price_minor: 100 }])).toThrow();
    expect(() => computeSale([{ description: "x", quantity: 1, unit_price_minor: 100, tax_rate: 1.5 }])).toThrow();
    expect(() => computeSale([])).toThrow();
  });
});

describe("estados: cobro y facturación son independientes", () => {
  const sale = { total_minor: BigInt(10000) };
  it("cobro depende solo de lo cobrado", () => {
    expect(collectionStatus({ ...sale, settled_minor: BigInt(0) })).toBe("PENDING");
    expect(collectionStatus({ ...sale, settled_minor: BigInt(4000) })).toBe("PARTIAL");
    expect(collectionStatus({ ...sale, settled_minor: BigInt(10000) })).toBe("COLLECTED");
    expect(collectionStatus({ ...sale, settled_minor: BigInt(0), voided_at: new Date() })).toBe("VOIDED");
  });
  it("facturación depende solo de lo documentado y de la marca manual", () => {
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(0) })).toBe("NONE");
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(0), invoicing_flag: "PENDING" })).toBe("PENDING");
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(3000) })).toBe("PARTIAL");
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(10000) })).toBe("INVOICED");
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(10000), invoicing_flag: "INCIDENT" })).toBe("INCIDENT");
  });
  it("una venta cobrada al 100% sin CFDI sigue sin facturar; una facturada sin cobro sigue pendiente de cobro", () => {
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(0) })).toBe("NONE");
    expect(collectionStatus({ ...sale, settled_minor: BigInt(10000) })).toBe("COLLECTED");
    expect(collectionStatus({ ...sale, settled_minor: BigInt(0) })).toBe("PENDING");
    expect(invoicingStatus({ ...sale, documented_minor: BigInt(10000) })).toBe("INVOICED");
  });
  it("calcula lo documentado, lo pendiente y la diferencia", () => {
    expect(documentation(10000, 0)).toEqual({ documented_minor: 0, pending_to_document_minor: 10000, difference_minor: null });
    expect(documentation(10000, 7000)).toEqual({ documented_minor: 7000, pending_to_document_minor: 3000, difference_minor: 3000 });
    expect(documentation(10000, 12000).difference_minor).toBe(-2000);
  });
});

describe("vinculación de CFDI: importes", () => {
  it("el importe por defecto es lo que cabe en la operación y en el CFDI", () => {
    expect(defaultAllocation(10000, 0, 10000, 0)).toBe(10000);
    expect(defaultAllocation(10000, 4000, 20000, 15000)).toBe(5000);
    expect(defaultAllocation(10000, 10000, 10000, 0)).toBe(0);
  });
  it("un CFDI puede amparar varias operaciones y una operación varios CFDI sin exceder lo disponible", () => {
    expect(() => assertAllocation(6000, 10000, 4000, 20000, 0)).not.toThrow();
    expect(() => assertAllocation(7000, 10000, 4000, 20000, 0)).toThrow();       // excede lo que falta en la operación
    expect(() => assertAllocation(6000, 10000, 0, 20000, 15000)).toThrow();      // excede lo que le queda al CFDI
    expect(() => assertAllocation(0, 10000, 0, 20000, 0)).toThrow();
    expect(() => assertAllocation(10050, 10000, 0, 20000, 0)).not.toThrow();     // tolerancia de redondeo
  });
});
