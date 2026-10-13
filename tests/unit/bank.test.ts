import { describe, expect, it } from "vitest";
import { parseAmount, parseBankCsv, parseDate, withDedupeKeys } from "@/lib/bank/parse";
import { suggest } from "@/lib/bank/match";

describe("estado de cuenta", () => {
  it("fechas y importes", () => {
    expect(parseDate("13/10/2026")).toBe("2026-10-13"); expect(parseDate("2026-10-13")).toBe("2026-10-13"); expect(parseDate("05-Oct-2026")).toBe("2026-10-05"); expect(parseDate("31/02/2026")).toBeNull();
    expect(parseAmount("$1,234.50")).toBe(123450); expect(parseAmount("(100.00)")).toBe(-10000); expect(parseAmount("100.00-")).toBe(-10000); expect(parseAmount("-0.5")).toBe(-50); expect(parseAmount("abc")).toBeNull(); expect(parseAmount("")).toBeNull();
  });
  it("cargos y abonos en columnas separadas, con preámbulo y punto y coma", () => {
    const r = parseBankCsv("Banco X;Cuenta 1234\nFecha;Descripción;Cargo;Abono;Saldo\n12/10/2026;OXXO CABO;121.00;;5,000.00\n13/10/2026;SPEI CLIENTE;;2,500.00;7,500.00\nbasura;;;;\n");
    expect(r.rows).toEqual([{ posted_at: "2026-10-12", description: "OXXO CABO", amount_minor: -12100, balance_minor: 500000, reference: null }, { posted_at: "2026-10-13", description: "SPEI CLIENTE", amount_minor: 250000, balance_minor: 750000, reference: null }]);
    expect(r.skipped).toBe(1);
  });
  it("monto único con signo", () => {
    const r = parseBankCsv('Fecha,Concepto,Monto\n2026-10-12,"Renta, Casa Cabo",-8200.00\n2026-10-13,Depósito,100.00');
    expect(r.rows.map((x) => x.amount_minor)).toEqual([-820000, 10000]);
  });
  it("error claro sin encabezado", () => { expect(() => parseBankCsv("a,b\n1,2")).toThrow(/encabezado/); });
  it("dos movimientos idénticos el mismo día no se funden; reimportar da las mismas llaves", () => {
    const rows = [{ posted_at: "2026-10-12", description: "CAFE", amount_minor: -5000, balance_minor: null, reference: null }];
    const a = withDedupeKeys([...rows, ...rows]), b = withDedupeKeys([...rows, ...rows]);
    expect(a[0]!.dedupe_key).not.toBe(a[1]!.dedupe_key); expect(a.map((x) => x.dedupe_key)).toEqual(b.map((x) => x.dedupe_key));
  });
  it("sugiere por importe exacto, fecha y nombre", () => {
    const s = suggest({ posted_at: "2026-10-12", description: "COMPRA OXXO CABO", amount_minor: -12100 }, [
      { kind: "expense", id: "1", label: "Cerveza", date: "2026-10-11", amount_minor: 12100, counterparty: "Cadena Comercial Oxxo" },
      { kind: "expense", id: "2", label: "Otro", date: "2026-10-11", amount_minor: 9900, counterparty: null },
      { kind: "expense", id: "3", label: "Lejano", date: "2026-05-01", amount_minor: 12100, counterparty: null },
    ]);
    expect(s.map((x) => x.id)).toEqual(["1"]); expect(s[0]!.score).toBeGreaterThan(80);
  });
});
