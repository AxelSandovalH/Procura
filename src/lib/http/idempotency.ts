import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { Problem } from "@/lib/http/problem";
import { withContext } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";

/**
 * Idempotencia de escritura (cabecera `Idempotency-Key`, retención 24 h). Misma clave + mismo cuerpo ⇒ misma respuesta
 * sin repetir el efecto; misma clave + otro cuerpo ⇒ 422; con una llave de API la cabecera es obligatoria.
 * `body` es el cuerpo ya leído y validado (el hash lo usa para detectar reutilización con otro cuerpo). Si el handler falla, la clave se libera para poder reintentar.
 */
export async function idempotent(req: Request, actor: Actor, body: unknown, handler: () => Promise<{ status: number; body: unknown }>): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) {
    if (actor.type === "API_KEY") throw new Problem(400, "Falta Idempotency-Key", "Las peticiones con llave de API deben enviar la cabecera Idempotency-Key (un uuid por operación).");
    const r = await handler(); return NextResponse.json(r.body, { status: r.status });
  }
  if (key.length > 200) throw Problem.badRequest("Idempotency-Key demasiado larga");
  const orgCtx = { userId: actor.userId, organizationId: actor.organizationId };
  const hash = createHash("sha256").update(`${req.method} ${new URL(req.url).pathname}\n${JSON.stringify(body ?? null)}`).digest("hex");

  const claim = await withContext(orgCtx, async (tx) => {
    await tx.idempotency_keys.deleteMany({ where: { organization_id: actor.organizationId, key, expires_at: { lt: new Date() } } });
    const inserted = await tx.$executeRaw`insert into idempotency_keys (organization_id, key, request_hash) values (${actor.organizationId}::uuid, ${key}, ${hash}) on conflict do nothing`;
    if (inserted === 1) return { fresh: true as const };
    return { fresh: false as const, row: await tx.idempotency_keys.findUniqueOrThrow({ where: { organization_id_key: { organization_id: actor.organizationId, key } } }) };
  });

  if (!claim.fresh) {
    if (claim.row.request_hash !== hash) throw new Problem(422, "Idempotency-Key reutilizada", "Esa clave ya se usó con un cuerpo distinto.");
    if (claim.row.response_status == null) throw Problem.conflict("Una petición con esa Idempotency-Key aún se está procesando; reintenta en unos segundos.");
    return NextResponse.json(claim.row.response_body, { status: claim.row.response_status, headers: { "idempotent-replayed": "true" } });
  }

  try {
    const r = await handler();
    const stored = JSON.parse(JSON.stringify(r.body));
    await withContext(orgCtx, (tx) => tx.idempotency_keys.update({ where: { organization_id_key: { organization_id: actor.organizationId, key } }, data: { response_status: r.status, response_body: stored } }));
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    await withContext(orgCtx, (tx) => tx.idempotency_keys.deleteMany({ where: { organization_id: actor.organizationId, key } })).catch(() => {});
    throw err;
  }
}
