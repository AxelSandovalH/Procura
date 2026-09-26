import type { Tx } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/context";
import type { event_perspective } from "@prisma/client";
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
  // domain_events es INTERNAL (RLS de una sola org); un evento shared casi siempre incluye a la
  // contraparte del actor. app.emit_domain_event_row (SECURITY DEFINER) inserta cada fila sin
  // depender del contexto RLS de la transacción — de lo contrario el INSERT de la contraparte
  // abortaría toda la acción de negocio que disparó el evento, no solo la notificación.
  const actorJson = JSON.stringify(actorPayload);
  for (const r of input.recipients) {
    await tx.$executeRaw`select app.emit_domain_event_row(${eventKey}::uuid, ${input.type}, ${input.aggregateType}, ${input.aggregateId}::uuid, ${r.organizationId}::uuid, ${r.perspective}::event_perspective, ${actorJson}::jsonb, ${JSON.stringify(r.payload)}::jsonb)`;
  }
  return eventKey;
}

/**
 * Notificaciones in-app para memberships puntuales, ligadas al evento recién emitido.
 * notifications es INTERNAL y estas memberships casi siempre son de la organización CONTRAPARTE
 * del actor — mismo motivo que emitEvent: sin la función definer, el INSERT viola RLS y aborta
 * la transacción de negocio completa, no solo la notificación.
 */
export async function notify(tx: Tx, params: { organizationId: string; membershipIds: string[]; eventId?: string; type: string; title: string; body?: string; resourceType: string; resourceId: string }) {
  const ids = [...new Set(params.membershipIds)].filter(Boolean);
  for (const membershipId of ids) {
    await tx.$executeRaw`select app.create_notification_row(${params.organizationId}::uuid, ${membershipId}::uuid, ${params.eventId ?? null}::uuid, ${params.type}, ${params.title}, ${params.body ?? null}, ${params.resourceType}, ${params.resourceId}::uuid)`;
  }
}

/**
 * Memberships ACTIVE con un permiso dado en la organización (para notificar "a quién corresponda").
 * Vía función SECURITY DEFINER: esta consulta casi siempre se hace para la organización
 * CONTRAPARTE del actor (ej. avisar a Compras del comprador cuando el proveedor cotiza), y
 * role_assignments es INTERNAL — bajo el contexto RLS del actor, un SELECT normal devolvería 0
 * filas en silencio (sin lanzar error) en vez de fallar de forma visible.
 */
export async function membershipsWithPermission(tx: Tx, organizationId: string, permissionCode: string, excludeMembershipId?: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ membership_id: string }[]>`select * from app.memberships_with_permission(${organizationId}::uuid, ${permissionCode}, ${excludeMembershipId ?? null}::uuid)`;
  return rows.map((r) => r.membership_id);
}

/** Notifica a todos los memberships ACTIVE con un permiso dado (ej. "rfq.issue" = Compras). */
export async function notifyPermissionHolders(tx: Tx, params: { organizationId: string; permission: string; excludeMembershipId?: string; type: string; title: string; body?: string; resourceType: string; resourceId: string }) {
  const ids = await membershipsWithPermission(tx, params.organizationId, params.permission, params.excludeMembershipId);
  await notify(tx, { organizationId: params.organizationId, membershipIds: ids, type: params.type, title: params.title, body: params.body, resourceType: params.resourceType, resourceId: params.resourceId });
}
