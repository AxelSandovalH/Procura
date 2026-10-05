export type Tone = "neutral" | "info" | "warn" | "ok" | "bad" | "muted";

export const REQUISITION_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "muted" },
  SUBMITTED: { label: "Por cotizar", tone: "info" },
  PENDING_APPROVAL: { label: "En aprobación", tone: "warn" },
  APPROVED: { label: "Aprobada", tone: "ok" },
  SENT: { label: "Cotizando", tone: "info" },
  IN_PROCESS: { label: "En proceso", tone: "info" },
  RESOLVED: { label: "Resuelta", tone: "ok" },
  CLOSED: { label: "Cerrada", tone: "muted" },
  REJECTED: { label: "Rechazada", tone: "bad" },
  CANCELLED: { label: "Cancelada", tone: "bad" },
};

export const RFQ_STATUS: Record<string, { label: string; tone: Tone }> = {
  SENT: { label: "Enviada", tone: "info" }, VIEWED: { label: "Vista", tone: "info" }, QUOTED: { label: "Cotizada", tone: "ok" },
  DECLINED: { label: "Declinada", tone: "bad" }, WITHDRAWN: { label: "Retirada", tone: "muted" }, CLOSED: { label: "Cerrada", tone: "muted" },
};

export const QUOTATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "muted" }, SUBMITTED: { label: "Enviada", tone: "info" }, WITHDRAWN: { label: "Retirada", tone: "muted" },
  SUPERSEDED: { label: "Reemplazada", tone: "muted" }, ACCEPTED: { label: "Aceptada", tone: "ok" }, NOT_SELECTED: { label: "No seleccionada", tone: "muted" },
  REJECTED: { label: "Rechazada", tone: "bad" }, EXPIRED: { label: "Vencida", tone: "warn" },
};

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_CONFIRMATION: { label: "Por confirmar", tone: "warn" }, CONFIRMED: { label: "Confirmada", tone: "info" }, IN_PROCESS: { label: "En proceso", tone: "info" },
  COMPLETED: { label: "Completada", tone: "ok" }, REJECTED: { label: "Rechazada", tone: "bad" }, CANCELLED: { label: "Cancelada", tone: "bad" },
};

export const RELATIONSHIP_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendiente", tone: "warn" }, ACTIVE: { label: "Activa", tone: "ok" }, SUSPENDED: { label: "Suspendida", tone: "warn" },
  FINALIZED: { label: "Finalizada", tone: "muted" }, REJECTED: { label: "Rechazada", tone: "bad" },
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
