import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { xlsxToCsv } from "@/lib/sales/xlsx";
import { parseSalesCsv } from "@/lib/sales/import";

async function book(fill: (wb: ExcelJS.Workbook) => void) { const wb = new ExcelJS.Workbook(); fill(wb); const buf = await wb.xlsx.writeBuffer(); return { arrayBuffer: async () => buf as ArrayBuffer }; }

describe("Excel → ventas", () => {
  it("convierte fechas, números y fórmulas y salta hojas vacías", async () => {
    const f = await book((wb) => {
      wb.addWorksheet("Vacía");
      const ws = wb.addWorksheet("Ventas"); ws.addRow(["Folio", "Fecha", "Total", "Forma de pago", "Producto"]);
      ws.addRow(["A-1", new Date(Date.UTC(2026, 9, 12)), 1160, "Tarjeta de crédito", 'Cena, "vino"']);
      ws.addRow(["A-2", new Date(Date.UTC(2026, 9, 13)), { formula: "100+145.5", result: 245.5 }, "Efectivo", "Café"]);
    });
    const p = parseSalesCsv(await xlsxToCsv(f));
    expect(p.rows.map((r) => [r.folio, r.total_minor, String(r.sold_at).slice(0, 10)])).toEqual([["A-1", 116000, "2026-10-12"], ["A-2", 24550, "2026-10-13"]]);
    expect(p.rows[0]!.description).toBe('Cena, "vino"');
  });
  it("libro sin datos: error claro", async () => { await expect(xlsxToCsv(await book((wb) => wb.addWorksheet("x")))).rejects.toThrow(/no tiene datos/); });
});
