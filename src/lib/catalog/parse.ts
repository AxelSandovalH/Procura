import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

const MAX_PREVIEW_ROWS = 20;
const MAX_ROWS = 5000;

/** Detecta CSV vs XLSX por el nombre de archivo (el import ya validó el content-type en el POST). */
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const isXlsx = /\.xlsx?$/i.test(filename);
  return isXlsx ? parseXlsx(buffer) : parseCsvBuffer(buffer);
}

function parseCsvBuffer(buffer: Buffer): ParsedSheet {
  const records: string[][] = parseCsv(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, to: MAX_ROWS + 1 });
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) => rowToObject(headers, r));
  return { headers, rows };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => { headers[colNumber - 1] = String(cell.value ?? "").trim(); });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= MAX_ROWS) return;
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => { values[colNumber - 1] = cellToString(cell.value); });
    if (values.some((v) => v && v.trim() !== "")) rows.push(rowToObject(headers, values));
  });
  return { headers: headers.filter(Boolean), rows };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "");
  if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "");
  return String(value);
}

function rowToObject(headers: string[], values: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => { if (h) obj[h] = (values[i] ?? "").toString().trim(); });
  return obj;
}

export function previewRows(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.slice(0, MAX_PREVIEW_ROWS);
}
