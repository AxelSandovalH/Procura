import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import type { Prisma, event_perspective } from "@prisma/client";
import { randomUUID } from "node:crypto";

export interface Recipient { organizationId: string; perspective: event_perspective; payload: Record<string, unknown> }

export interface EmitInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  actor: Actor;
  recipients: Recipient[];
}

/**
 * Escribe un DomainEvent (outbox) por organización receptora, cada uno ya con el payload
 * filtrado por perspectiva por el caller — nunca se decide la perspectiva en el consumidor.
 * Un solo event_key agrupa los envelopes del mismo hecho (EVENTS.md §2).
 */
export async function emitEvent(tx: Tx, input: EmitInput): Promise<string> {
  const eventKey = randomUUID();
  const actorPayload = { type: input.actor.type, membership_id: input.actor.membershipId, organization_id: input.actor.organizationId };
  await tx.domain_events.createMany({
    data: input.recipients.map((r) => ({
      event_key: eventKey, type: input.type, aggregate_type: input.aggregateType, aggregate_id: input.aggregateId,
      organization_id: r.organizationId, perspective: r.perspective, actor: actorPayload as Prisma.InputJsonValue, payload: r.payload as Prisma.InputJsonValue,
    })),
  });
  return eventKey;
}

/** Notificaciones in-app para memberships puntuales, ligadas al evento recién emitido. */
export async function notify(tx: Tx, params: { organizationId: string; membershipIds: string[]; eventIdByOrg?: Map<string, string>; type: string; title: string; body?: string; resourceType: string; resourceId: string }) {
  const ids = [...new Set(params.membershipIds)].filter(Boolean);
  if (ids.length === 0) return;
  await tx.notifications.createMany({
    data: ids.map((membershipId) => ({
      organization_id: params.organizationId, membership_id: membershipId, type: params.type, title: params.title, body: params.body,
      resource_type: params.resourceType, resource_id: params.resourceId,
    })),
  });
}

/** Memberships ACTIVE con un permiso dado en la organización (para notificar "a quién corresponda"). */
export async function membershipsWithPermission(tx: Tx, organizationId: string, permissionCode: string, excludeMembershipId?: string): Promise<string[]> {
  const rows = await tx.role_assignments.findMany({
    where: { organization_id: organizationId, revoked_at: null, roles: { role_permissions: { some: { permission_code: permissionCode } } }, memberships_role_assignments_membership_idTomemberships: { status: "ACTIVE" } },
    select: { membership_id: true },
  });
  const ids = [...new Set(rows.map((r) => r.membership_id))];
  return excludeMembershipId ? ids.filter((id) => id !== excludeMembershipId) : ids;
}

/** Notifica a todos los memberships ACTIVE con un permiso dado (ej. "rfq.issue" = Compras). */
export async function notifyPermissionHolders(tx: Tx, params: { organizationId: string; permission: string; excludeMembershipId?: string; type: string; title: string; body?: string; resourceType: string; resourceId: string }) {
  const ids = await membershipsWithPermission(tx, params.organizationId, params.permission, params.excludeMembershipId);
  await notify(tx, { organizationId: params.organizationId, membershipIds: ids, type: params.type, title: params.title, body: params.body, resourceType: params.resourceType, resourceId: params.resourceId });
}
