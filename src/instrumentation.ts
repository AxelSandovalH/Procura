import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
}

/** Errores de renderizado y rutas no capturados por nuestro wrapper `route()`. */
export const onRequestError = Sentry.captureRequestError;
