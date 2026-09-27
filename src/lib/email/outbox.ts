import { prisma } from "@/lib/db/client";
import { env } from "@/lib/env";
import { renderNotificationEmail, type EmailNotification } from "@/lib/email/templates";

const BATCH = 25;
const TIMEOUT_MS = 10_000;

interface Claimed extends EmailNotification { id: string; email: string }

export async function sendViaResend(apiKey: string, from: string, to: string, msg: { subject: string; html: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${process.env.RESEND_API_URL ?? "https://api.resend.com"}/emails`, {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(timer); }
}

/**
 * Envía por correo las notificaciones pendientes (mismo cron que despacha webhooks). Sin RESEND_API_KEY no hace nada
 * y no reclama filas, así que activar la variable después no pierde avisos recientes (salvo los de más de 2 días).
 */
export async function sendPendingEmails(): Promise<{ enabled: boolean; sent: number; failed: number }> {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { enabled: false, sent: 0, failed: 0 };

  const db = prisma();
  const rows = await db.$queryRaw<Claimed[]>`select * from app.email_outbox_claim(${BATCH})`;
  let sent = 0, failed = 0;
  const appUrl = env().APP_URL;
  await Promise.all(rows.map(async (row) => {
    const r = await sendViaResend(apiKey, from, row.email, renderNotificationEmail(row, appUrl));
    await db.$executeRaw`select app.email_outbox_result(${row.id}::uuid, ${r.ok}, ${r.error ?? null})`;
    if (r.ok) sent++; else failed++;
  }));
  return { enabled: true, sent, failed };
}

/** Envía un correo suelto (invitaciones). Devuelve false si el envío está apagado o falla; nunca lanza. */
export async function sendEmailNow(to: string, msg: { subject: string; html: string; text: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;
  const r = await sendViaResend(apiKey, from, to, msg);
  if (!r.ok) console.warn("[email] invitación no enviada:", r.error);
  return r.ok;
}
