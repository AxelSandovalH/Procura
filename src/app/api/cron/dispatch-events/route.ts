import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runDispatchCycle } from "@/lib/events/dispatch";
import { sendPendingEmails } from "@/lib/email/outbox";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Invocado por Vercel Cron cada minuto (vercel.json). Protegido por CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });

  const result = await runDispatchCycle();
  // Los correos no deben tumbar el despacho de webhooks: si fallan, se reportan y el ciclo sigue.
  const emails = await sendPendingEmails().catch((e) => ({ enabled: true, sent: 0, failed: -1, error: e instanceof Error ? e.message : String(e) }));
  await prisma().$executeRaw`select app.rate_limit_gc()`.catch(() => 0);
  // Señales operativas: correos que no salen o entregas de webhook agotadas merecen una alerta, no un log perdido.
  if (emails.failed !== 0) Sentry.captureMessage(`Correos de aviso con fallas (${emails.failed})`, "warning");
  if (result.failed > 0) Sentry.captureMessage(`Entregas de webhook fallidas en el ciclo (${result.failed})`, "info");
  return NextResponse.json({ ok: true, ...result, emails });
}
