import type { Actor } from "@/lib/auth/context";
import { withContext } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

/** Solo el administrador principal de la organización contrata, compra créditos y administra la suscripción. */
export async function requirePrimaryAdmin(actor: Actor): Promise<void> {
  if (!actor.membershipId) throw Problem.forbidden("Solo una persona de la organización puede contratar un plan.");
  const m = await withContext({ userId: actor.userId ?? undefined, organizationId: actor.organizationId }, (tx) => tx.memberships.findUnique({ where: { id: actor.membershipId! }, select: { is_primary_admin: true } }));
  if (!m?.is_primary_admin) throw Problem.forbidden("Solo el administrador principal de la organización puede contratar o cambiar el plan.");
}
