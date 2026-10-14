/** Un libro de Excel (.xlsx) se convierte aquí en CSV: la primera hoja que tenga datos; las fechas salen como dd/mm/aaaa y los números sin formato. */
export async function xlsxToCsv(file: { arrayBuffer(): Promise<ArrayBuffer> }) {
  const { default: ExcelJS } = await import("exceljs"); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
  const cell = (v: unknown): string => {
    if (v == null) return ""; if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}`;
    if (typeof v === "object") { const o = v as { result?: unknown; text?: string; richText?: { text: string }[] }; return o.richText ? o.richText.map((t) => t.text).join("") : o.result !== undefined ? cell(o.result) : (o.text ?? ""); }
    return String(v);
  };
  const q = (t: string) => (/[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  for (const ws of wb.worksheets) {
    const lines: string[] = []; ws.eachRow({ includeEmpty: false }, (row) => { const vals = (row.values as unknown[]).slice(1); lines.push(Array.from({ length: vals.length }, (_, i) => q(cell(vals[i]))).join(",")); });
    if (lines.length > 1) return lines.join("\n");
  }
  throw new Error("El libro de Excel no tiene datos en ninguna hoja.");
}
