export type Tone = "neutral" | "info" | "warn" | "ok" | "bad" | "muted";

export const REQUISITION_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "muted" },
  PENDING_APPROVAL: { label: "En aprobación", tone: "warn" },
  APPROVED: { label: "Aprobada", tone: "ok" },
  SENT: { label: "Cotizando", tone: "info" },
  IN_PROCESS: { label: "En proceso", tone: "info" },
  RESOLVED: { label: "Resuelta", tone: "ok" },
  CLOSED: { label: "Cerrada", tone: "muted" },
  REJECTED: { label: "Rechazada", tone: "bad" },
  CANCELLED: { label: "Cancelada", tone: "bad" },
};

export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  LOW: { label: "Baja", tone: "muted" },
  NORMAL: { label: "Normal", tone: "neutral" },
  HIGH: { label: "Alta", tone: "warn" },
  URGENT: { label: "Urgente", tone: "bad" },
};

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};
