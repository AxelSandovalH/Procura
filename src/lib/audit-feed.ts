import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db/client";
import { AUDIT_NOISE } from "@/lib/ui/audit-labels";

export interface AuditItem {
  id: string; occurred_at: Date; action: string; resource_type: string; resource_id: string | null; resource_label: string | null;
  reason: string | null; changes: unknown; metadata: unknown; actor: { kind: "USER" | "API_KEY" | "SYSTEM"; name: string | null; organization: string | null };
}

/** Entradas de auditoría visibles para la organización, con el nombre de quien actuó (persona, organización, API o sistema). */
export async function loadAuditFeed(tx: Tx, organizationId: string, where: Prisma.audit_logsWhereInput, limit = 200, noise = false): Promise<AuditItem[]> {
  const rows = await tx.audit_logs.findMany({
    where: { AND: [{ visible_to_organization_ids: { has: organizationId } }, noise ? {} : { action: { notIn: AUDIT_NOISE } }, where] },
    orderBy: { occurred_at: "desc" }, take: limit,
  });
  const membershipIds = [...new Set(rows.map((r) => r.membership_id).filter((x): x is string => !!x))];
  const ms = membershipIds.length ? await tx.memberships.findMany({ where: { id: { in: membershipIds } }, select: { id: true, users: { select: { full_name: true, email: true } } } }) : [];
  const nameOf = new Map(ms.map((m) => [m.id, m.users.full_name || m.users.email]));
  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const orgs = await tx.organizations.findMany({ where: { id: { in: orgIds } }, select: { id: true, display_name: true } });
  const orgName = new Map(orgs.map((o) => [o.id, o.display_name]));
  return rows.map((r) => ({
    id: r.id, occurred_at: r.occurred_at, action: r.action, resource_type: r.resource_type, resource_id: r.resource_id, resource_label: r.resource_label,
    reason: r.reason, changes: r.changes, metadata: r.metadata,
    actor: { kind: r.actor_type, name: r.membership_id ? (nameOf.get(r.membership_id) ?? null) : null, organization: orgName.get(r.organization_id) ?? null },
  }));
}
