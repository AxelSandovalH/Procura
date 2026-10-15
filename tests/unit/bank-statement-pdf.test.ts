import { describe, expect, it } from "vitest";
import { statementToCsv, type Statement } from "@/lib/bank/statement-pdf";
import { parseBankCsv } from "@/lib/bank/parse";

const base: Statement = { is_statement: true, period_start: "2026-10-01", period_end: "2026-10-31", opening_balance: 1000, total_charges: 350.5, total_deposits: 9000, notes: null, movements: [
  { date: "2026-10-02", description: "SPEI RECIBIDO  SERGIO\nPAGO", charge: null, deposit: 9000, balance: 10000, reference: "0012345" },
  { date: "2026-10-03", description: "COMPRA \"OXXO\", CENTRO", charge: 350.5, deposit: null, balance: 9649.5, reference: null },
] };

describe("estado de cuenta en PDF → CSV", () => {
  it("genera un CSV que la importación entiende, con cargos negativos y abonos positivos", () => {
    const { csv, rows, warnings } = statementToCsv(base);
    expect(rows).toBe(2); expect(warnings).toEqual([]);
    const p = parseBankCsv(csv);
    expect(p.rows.map((r) => [r.posted_at, r.amount_minor, r.balance_minor])).toEqual([["2026-10-02", 900000, 1000000], ["2026-10-03", -35050, 964950]]);
    expect(p.rows[1]!.description).toBe('COMPRA "OXXO", CENTRO');
  });
  it("avisa si los totales leídos no cuadran con el resumen del estado de cuenta", () => {
    const { warnings } = statementToCsv({ ...base, total_charges: 800, total_deposits: 9000 });
    expect(warnings.join(" ")).toMatch(/cargos leídos suman 350.50.*800.00/);
  });
  it("omite filas inválidas y lo informa", () => {
    const { rows, dropped, warnings } = statementToCsv({ ...base, movements: [...base.movements, { date: "02/OCT", description: "x", charge: 1, deposit: null, balance: null, reference: null }, { date: "2026-10-05", description: "ambiguo", charge: 5, deposit: 5, balance: null, reference: null }] });
    expect(rows).toBe(2); expect(dropped).toBe(2); expect(warnings[0]).toMatch(/2 movimientos/);
  });
});
