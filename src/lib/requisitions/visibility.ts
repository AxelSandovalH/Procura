import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";

/** Filtro Prisma para lo que el actor puede ver: todo (read_all), propio + scope de departamento/localización, o nada. */
export function requisitionVisibilityWhere(actor: Actor): Prisma.requisitionsWhereInput | null {
  if (actor.permissions.has("requisition.read_all")) return {};
  if (!actor.permissions.has("requisition.read")) return null;

  const deptIds = new Set<string>();
  const locIds = new Set<string>();
  let orgWide = false;
  for (const r of actor.roles) {
    if (!r.permissions.has("requisition.read")) continue;
    if (r.scopeType === "ORGANIZATION") orgWide = true;
    else if (r.scopeType === "DEPARTMENT" && r.scopeId) deptIds.add(r.scopeId);
    else if (r.scopeType === "LOCATION" && r.scopeId) locIds.add(r.scopeId);
  }
  if (orgWide) return {};

  const or: Prisma.requisitionsWhereInput[] = [];
  if (actor.membershipId) or.push({ requester_membership_id: actor.membershipId });
  if (deptIds.size > 0) or.push({ department_id: { in: [...deptIds] } });
  if (locIds.size > 0) or.push({ location_id: { in: [...locIds] } });
  return or.length > 0 ? { OR: or } : { id: "__none__" };
}
