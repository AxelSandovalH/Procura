import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const redact = (s?: string) => s?.replace(/postgres(ql)?:\/\/[^\s"']+/g, "<url>").replace(/\b(pk_live_|re_|whsec_)[A-Za-z0-9_-]+/g, "$1<redacted>");

/**
 * Las migas de pan de consola repiten el error completo (con su pila y datos) y son la fuga más fácil:
 * se descartan; las demás pasan con el mensaje depurado.
 */
export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.category === "console") return null;
  if (b.message) b.message = redact(b.message);
  delete b.data;
  return b;
}

/** Quita de cada evento lo sensible antes de salir hacia Sentry: cookies, tokens, cuerpos y cadenas de conexión. */
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) if (/^(cookie|authorization|x-api-key|procura-signature)$/i.test(h)) delete event.request.headers[h];
    }
  }
  for (const ex of event.exception?.values ?? []) ex.value = redact(ex.value);
  if (event.message) event.message = redact(event.message);
  event.breadcrumbs = (event.breadcrumbs ?? []).map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  return event;
}

export const SENTRY_COMMON = {
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
} as const;
