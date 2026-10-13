import JSZip from "jszip";
import { Problem } from "@/lib/http/problem";

export interface BulkFile { name: string; bytes: Buffer }
const MAX_FILES = 200, MAX_XML = 2 * 1024 * 1024, MAX_PDF = 20 * 1024 * 1024, MAX_ZIP = 25 * 1024 * 1024, MAX_TOTAL = 150 * 1024 * 1024;

const baseName = (n: string) => (n.split(/[\\/]/).pop() ?? n).replace(/\.[^.]+$/, "").toLowerCase();
const extOf = (n: string) => (n.split(".").pop() ?? "").toLowerCase();

/** Lee una entrada del ZIP con tope de bytes: un ZIP malicioso no puede hacernos descomprimir sin límite. */
function readCapped(entry: JSZip.JSZipObject, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const stream = entry.nodeStream("nodebuffer");
    stream.on("data", (c: Buffer) => { size += c.length; if (size > cap) { (stream as unknown as { destroy(): void }).destroy(); reject(Problem.badRequest(`«${entry.name}» excede el tamaño permitido`)); } else chunks.push(c); });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** Junta los XML y PDF subidos (sueltos o dentro de ZIP) y empareja cada PDF con el XML del mismo nombre. */
export async function collectCfdiFiles(files: File[]) {
  const xml: BulkFile[] = [], pdf = new Map<string, BulkFile>(), notes: { file: string; message: string }[] = [];
  let total = 0;
  const add = (name: string, bytes: Buffer) => {
    total += bytes.length; if (total > MAX_TOTAL) throw Problem.badRequest("Los archivos exceden el tamaño total permitido (150 MB)");
    const ext = extOf(name);
    if (ext === "xml") { if (bytes.length > MAX_XML) notes.push({ file: name, message: "El XML excede 2 MB" }); else xml.push({ name, bytes }); }
    else if (ext === "pdf") { if (bytes.length > MAX_PDF) notes.push({ file: name, message: "El PDF excede 20 MB" }); else pdf.set(baseName(name), { name, bytes }); }
    else if (!name.endsWith("/") && !/(^|\/)(__MACOSX|\.DS_Store)/.test(name)) notes.push({ file: name, message: "Se ignoró: solo se leen archivos XML, PDF y ZIP" });
  };
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    if (extOf(f.name) === "zip") {
      if (bytes.length > MAX_ZIP) { notes.push({ file: f.name, message: "El ZIP excede 25 MB" }); continue; }
      let zip: JSZip;
      try { zip = await JSZip.loadAsync(bytes); } catch { notes.push({ file: f.name, message: "No se pudo leer el ZIP" }); continue; }
      const entries = Object.values(zip.files).filter((e) => !e.dir);
      if (entries.length > 1000) throw Problem.badRequest("El ZIP tiene demasiados archivos (máximo 1,000)");
      for (const e of entries) { const ext = extOf(e.name); if (ext !== "xml" && ext !== "pdf") { add(e.name, Buffer.alloc(0)); continue; } add(e.name, await readCapped(e, ext === "xml" ? MAX_XML : MAX_PDF)); }
    } else add(f.name, bytes);
    if (xml.length > MAX_FILES) throw Problem.badRequest(`Máximo ${MAX_FILES} comprobantes por carga`);
  }
  return { xml, pdf, notes };
}
export { baseName };
