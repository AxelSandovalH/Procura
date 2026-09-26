import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db/client";

const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 1440]; // 1m,5m,30m,2h,6h,24h — EVENTS.md §6
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;
const HTTP_TIMEOUT_MS = 10_000;

interface ClaimedRow {
  delivery_id: string; endpoint_id: string; url: string; secret: string; attempt?: number;
  event_id: string; event_type: string; schema_version: number; occurred_at: Date;
  aggregate_type: string; aggregate_id: string; organization_id: string; perspective: string;
  actor: unknown; payload: unknown;
}

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function sendOne(url: string, secret: string, body: string, eventId: string, type: string): Promise<{ ok: boolean; status?: number; responseBody?: string; error?: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(secret, timestamp, body);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST", signal: controller.signal, body,
      headers: { "content-type": "application/json", "procura-event-id": eventId, "procura-event-type": type, "procura-timestamp": timestamp, "procura-signature": `v1=${signature}` },
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, responseBody: text.slice(0, 4000) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function envelope(row: ClaimedRow): string {
  return JSON.stringify({
    id: row.event_id, type: row.event_type, version: row.schema_version, occurred_at: row.occurred_at,
    aggregate: { type: row.aggregate_type, id: row.aggregate_id }, actor: row.actor,
    organization_id: row.organization_id, perspective: row.perspective, data: row.payload,
  });
}

/**
 * Un ciclo del despachador (Vercel Cron cada minuto, OD-34 revisado). Todo el acceso cross-org
 * (leer eventos/endpoints de organizaciones ajenas al request) vive en funciones SECURITY DEFINER
 * — procura_app opera bajo RLS de una sola organización y no podría verlos de otro modo.
 */
export async function runDispatchCycle(): Promise<{ eventsProcessed: number; attempted: number; succeeded: number; failed: number }> {
  const db = prisma();
  let attempted = 0, succeeded = 0, failed = 0;

  const newDeliveries = await db.$queryRaw<ClaimedRow[]>`select * from app.dispatcher_claim_batch(200)`;
  for (const row of newDeliveries) {
    const result = await attempt(row, 1);
    attempted++;
    if (result === "SUCCEEDED") succeeded++; else failed++;
  }

  const dueRetries = await db.$queryRaw<ClaimedRow[]>`select * from app.dispatcher_claim_due_retries(200)`;
  for (const row of dueRetries) {
    const result = await attempt(row, row.attempt ?? 1);
    attempted++;
    if (result === "SUCCEEDED") succeeded++; else failed++;
  }

  // eventsProcessed: eventos distintos representados en este ciclo (aprox., para el resumen del cron).
  const eventsProcessed = new Set(newDeliveries.map((r) => r.event_id)).size;
  return { eventsProcessed, attempted, succeeded, failed };
}

async function attempt(row: ClaimedRow, currentAttempt: number): Promise<"SUCCEEDED" | "FAILED"> {
  const db = prisma();
  const body = envelope(row);
  const result = await sendOne(row.url, row.secret, body, row.event_id, row.event_type);

  if (result.ok) {
    await db.$executeRaw`select app.dispatcher_record_result(${row.delivery_id}::uuid, ${row.endpoint_id}::uuid, true, ${result.status ?? null}, ${result.responseBody ?? null}, null, ${currentAttempt}, null, false)`;
    return "SUCCEEDED";
  }

  const nextAttempt = currentAttempt + 1;
  const exhausted = currentAttempt >= MAX_ATTEMPTS;
  const nextRetryAt = exhausted ? null : new Date(Date.now() + BACKOFF_MINUTES[currentAttempt - 1] * 60_000);
  await db.$executeRaw`select app.dispatcher_record_result(${row.delivery_id}::uuid, ${row.endpoint_id}::uuid, false, ${result.status ?? null}, ${result.responseBody ?? null}, ${result.error ?? null}, ${nextAttempt}, ${nextRetryAt}, ${exhausted})`;
  return "FAILED";
}
