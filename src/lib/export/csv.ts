/** CSV para Excel: UTF-8 con BOM (acentos correctos), comillas escapadas, y celdas que empiezan con = + - @ neutralizadas para que Excel no las ejecute como fórmula. */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = typeof v === "boolean" ? (v ? "Sí" : "No") : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // un número negativo legítimo no se altera
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
/** Centavos (bigint o número) → pesos con dos decimales, como número. */
export const pesos = (minor: bigint | number | null | undefined): number | null => (minor === null || minor === undefined ? null : Number(minor) / 100);
export const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "");
