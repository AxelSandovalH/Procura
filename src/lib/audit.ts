import type { Tx } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";

export interface AuditEntry {
  actorType: "USER" | "API_KEY" | "SYSTEM";
  actorId?: string | null;
  membershipId?: string | null;
  apiKeyId?: string | null;
  organizationId: string;
  /** Otras organizaciones que deben ver esta entrada (recursos shared). Por defecto solo la propia. */
  visibleTo?: string[];
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  changes?: Prisma.InputJsonValue | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Escribe una entrada de auditoría. Llamar SIEMPRE dentro de la misma transacción que la mutación. */
export async function audit(tx: Tx, e: AuditEntry) {
  await tx.audit_logs.create({
    data: {
      actor_type: e.actorType,
      actor_id: e.actorId ?? null,
      membership_id: e.membershipId ?? null,
      api_key_id: e.apiKeyId ?? null,
      organization_id: e.organizationId,
      visible_to_organization_ids: e.visibleTo ?? [e.organizationId],
      action: e.action,
      resource_type: e.resourceType,
      resource_id: e.resourceId ?? null,
      resource_label: e.resourceLabel ?? null,
      changes: (e.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: e.reason ?? null,
      metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/** Campos base de auditoría derivados del actor autenticado del request. */
export function auditBase(actor: Actor): Pick<AuditEntry, "actorType" | "actorId" | "membershipId" | "apiKeyId" | "organizationId"> {
  return {
    actorType: actor.type,
    actorId: actor.userId ?? actor.apiKeyId ?? null,
    membershipId: actor.membershipId,
    apiKeyId: actor.apiKeyId,
    organizationId: actor.organizationId,
  };
}

/** Diff superficial entre dos objetos planos, solo con los campos que cambiaron. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (after[k] === undefined) continue;
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: before[k] ?? null, to: after[k] };
  }
  return out;
}
