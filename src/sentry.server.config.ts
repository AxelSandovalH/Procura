import * as Sentry from "@sentry/nextjs";
import { SENTRY_COMMON, scrubBreadcrumb, scrubEvent } from "@/lib/monitoring";

// Sin DSN queda apagado (desarrollo y previews sin configurar).
const dsn = process.env.SENTRY_DSN;
Sentry.init({ ...SENTRY_COMMON, dsn, enabled: !!dsn, beforeSend: scrubEvent, beforeBreadcrumb: scrubBreadcrumb });
