import { createHash } from "node:crypto";
import { withContext } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";
import { parseAmount } from "@/lib/bank/parse";

export interface AutoinvoiceInfo { organization_id: string; slug: string; display_name: string; welcome_text: string | null; window_days: number; daily_limit: number; default_payment_form: string }
/** Formas de pago que el cliente puede elegir en el portal (las de un ticket de mostrador). */
export const PORTAL_PAYMENT_FORMS: [string, string][] = [["01", "Efectivo"], ["03", "Transferencia electrónica"], ["04", "Tarjeta de crédito"], ["28", "Tarjeta de débito"]];

/** Portal de autofacturación por slug. 404 si no existe O si no está encendido (no revela cuál de las dos). */
export async function findAutoinvoice(slug: string): Promise<AutoinvoiceInfo> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(slug)) throw Problem.notFound("Portal no encontrado");
  const [row] = await withContext({}, (tx) => tx.$queryRaw<AutoinvoiceInfo[]>`select * from app.autoinvoice_public_info(${slug})`);
  if (!row) throw Problem.notFound("Portal no encontrado");
  return row;
}

/** Total escrito por el cliente («1,234.50», «$99») → centavos, o null. */
export const totalToMinor = (raw: string): number | null => { const n = parseAmount(raw); return n !== null && n > 0 ? n : null; };
export const hashIp = (ip: string) => createHash("sha256").update(`autoinvoice:${ip}`).digest("hex").slice(0, 32);

/** Forma de pago sugerida a partir del método registrado en la venta. */
export const suggestedPaymentForm = (method: string | null | undefined, fallback: string) => (method === "CASH" ? "01" : method === "TRANSFER" ? "03" : method === "CARD" ? "04" : fallback);

/** Cloudflare Turnstile (opcional): si hay clave secreta, el portal exige el desafío resuelto. Sin clave no se pide. */
export async function verifyCaptcha(token: string | undefined, ip: string): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!token) throw Problem.badRequest("Completa la verificación de seguridad.");
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { success?: boolean };
    if (!j.success) throw Problem.badRequest("No pudimos verificar que seas una persona. Inténtalo de nuevo.");
  } catch (e) { if (e instanceof Problem) throw e; throw new Problem(503, "Verificación no disponible", "No se pudo completar la verificación de seguridad. Inténtalo en un momento."); }
}

/** Mensaje seguro para el cliente: no se filtran saldos, credenciales ni detalles internos del proveedor fiscal. */
export function customerSafeMessage(detail: string | undefined): string {
  const generic = "El comercio no puede emitir facturas en este momento. Inténtalo más tarde o acude al establecimiento.";
  if (!detail) return generic;
  if (/saldo|cr[eé]dito|credencial|api key|tenant|timbres|certificad|csd|no configur|emisor|clave de producto|unidad sat|sin configurar|proveedor fiscal/i.test(detail)) return generic;
  return detail.slice(0, 300);
}
