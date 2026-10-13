import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { runDownloadSync } from "@/lib/fiscal/download";
import { rateLimit } from "@/lib/http/rate-limit";
import { assertFeature } from "@/lib/billing/entitlements";

export const maxDuration = 60;
const Body = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).refine((b) => !!b.from === !!b.to, { message: "Indica ambas fechas (from y to) o ninguna" });

/**
 * Sincroniza los CFDI del SAT con el proveedor fiscal. Sin fechas solo importa lo que ya esté listo; con `from` y `to` además pide al proveedor las
 * descargas de ese periodo (en ventanas de 30 días) y se importan cuando el SAT las entregue (puede tardar horas; el trabajo periódico las recoge).
 */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  await rateLimit("fiscal-sync", actor.organizationId, { windowSeconds: 600, max: 10 });
  authorize(actor, "cfdi.manage");
  await assertFeature(actor.organizationId, "sat_recovery");
  const body = await json(req, (d) => Body.parse(d ?? {}));
  const from = body.from ? new Date(body.from) : undefined, to = body.to ? new Date(`${body.to}T23:59:59.000Z`) : undefined;
  if (from && to && (from > to || to.getTime() - from.getTime() > 5 * 366 * 86_400_000)) throw Problem.badRequest("Periodo inválido (máximo 5 años)");
  try { return NextResponse.json(await runDownloadSync(actor.organizationId, actor.membershipId, { from, to })); }
  catch (e) { if (e instanceof FiscalProviderError) throw new Problem(e.code === "NOT_CONFIGURED" ? 409 : e.code === "NOT_SUPPORTED" ? 409 : e.code === "RATE_LIMITED" ? 429 : 502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
});
