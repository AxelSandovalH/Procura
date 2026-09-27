import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

/** IP del cliente tras el proxy de Vercel (primer salto de x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/**
 * Cuenta una solicitud contra `scope:subject` en una ventana fija y lanza 429 (con Retry-After) al pasar `max`.
 * `subject` se guarda con hash: no quedan IPs ni correos en claro. Si la base falla se deja pasar (fail-open):
 * un contador caído no debe impedir iniciar sesión.
 */
export async function rateLimit(scope: string, subject: string, opts: { windowSeconds: number; max: number }): Promise<void> {
  let row: { allowed: boolean; retry_after: number } | undefined;
  try {
    [row] = await prisma().$queryRaw<{ allowed: boolean; retry_after: number }[]>`select * from app.rate_limit_hit(${`${scope}:${digest(subject)}`}, ${opts.windowSeconds}, ${opts.max})`;
  } catch (e) {
    console.error("[rate-limit] fail-open:", e instanceof Error ? e.message : e);
    return;
  }
  if (row && !row.allowed) {
    throw new Problem(429, "Demasiadas solicitudes", `Intenta de nuevo en ${row.retry_after} segundos`, { retry_after: row.retry_after });
  }
}
