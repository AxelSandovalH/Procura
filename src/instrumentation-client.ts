import * as Sentry from "@sentry/nextjs";
import { SENTRY_COMMON, scrubBreadcrumb, scrubEvent } from "@/lib/monitoring";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
Sentry.init({ ...SENTRY_COMMON, dsn, enabled: !!dsn, beforeSend: scrubEvent, beforeBreadcrumb: scrubBreadcrumb });
