import { Problem } from "@/lib/http/problem";

/** Tipos permitidos → firma (magic bytes) que debe coincidir. null = texto plano, sin firma. */
const ALLOWED: Record<string, { ext: string[]; magic: number[][] | null }> = {
  "application/pdf": { ext: ["pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/png": { ext: ["png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: ["jpg", "jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: ["webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "text/csv": { ext: ["csv"], magic: null },
  "text/plain": { ext: ["txt"], magic: null },
};

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "archivo";
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\.{2,}/g, ".").trim().slice(0, 150);
  return cleaned || "archivo";
}

/** Valida tipo declarado, extensión y firma real del contenido (no basta con confiar en el content-type). */
export function validateFile(filename: string, mime: string, bytes: Buffer): void {
  const rule = ALLOWED[mime];
  if (!rule) throw Problem.badRequest(`Tipo de archivo no permitido: ${mime}`);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!rule.ext.includes(ext)) throw Problem.badRequest(`La extensión .${ext} no corresponde a ${mime}`);
  if (rule.magic && !rule.magic.some((sig) => sig.every((b, i) => bytes[i] === b))) {
    throw Problem.badRequest("El contenido del archivo no coincide con su tipo declarado");
  }
}
