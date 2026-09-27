import { route } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

/** TEMPORAL: provoca un 500 para comprobar que Sentry recibe errores de producción. Protegida con CRON_SECRET; se elimina tras la prueba. */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  throw new Error("Prueba de Sentry en producción (error provocado a propósito)");
});
