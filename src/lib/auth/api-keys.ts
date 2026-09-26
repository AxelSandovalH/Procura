import { randomBytes } from "node:crypto";
import { Problem } from "@/lib/http/problem";
import type { Actor } from "@/lib/auth/context";
import type { Tx } from "@/lib/db/client";
import { hashToken } from "@/lib/auth/token";

/** `pk_live_<43 chars>`; solo el hash sha256 se guarda, el secreto se devuelve una única vez. */
export function generateApiKey() {
  const secret = `pk_live_${randomBytes(32).toString("base64url")}`;
  return { secret, hash: hashToken(secret), prefix: secret.slice(0, 15) };
}

/** No-escalación (mismo criterio que asignar roles): una key no puede tener permisos que quien la crea no tiene. */
export async function assertRolesAllowed(tx: Tx, actor: Actor, roleIds: string[]) {
  const roles = await tx.roles.findMany({ where: { id: { in: roleIds }, organization_id: actor.organizationId, is_active: true }, include: { role_permissions: true } });
  if (roles.length !== roleIds.length) throw Problem.badRequest("Uno o más role_ids no existen o están inactivos");
  if (roles.some((r) => r.role_permissions.some((p) => !actor.permissions.has(p.permission_code as never)))) {
    throw Problem.forbidden("No puedes dar a una API key permisos que tú mismo no tienes");
  }
}
