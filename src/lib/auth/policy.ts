import { Problem } from "@/lib/http/problem";
import type { Actor } from "./context";
import { PERMISSION_SIDE, type Permission } from "./permissions";

/** Atributos mínimos que un recurso expone para autorización (RBAC.md §4). */
export interface Resource {
  organization_id?: string | null;          // INTERNAL
  buyer_organization_id?: string | null;    // SHARED
  supplier_organization_id?: string | null; // SHARED
  department_id?: string | null;
  location_id?: string | null;
}

/**
 * Motor de autorización (único punto de decisión):
 *  1. ¿algún rol tiene el permiso?
 *  2. side: el permiso aplica desde la posición correcta (buyer/supplier/owner) → si no, "no visible" (404)
 *  3. scope: alguna asignación con ese permiso cubre el recurso (org-wide, departamento o localización)
 */
export function can(actor: Actor, permission: Permission, resource?: Resource): boolean {
  const holders = actor.roles.filter((r) => r.permissions.has(permission));
  if (holders.length === 0) return false;
  if (!resource) return true;

  const side = PERMISSION_SIDE[permission] ?? "ANY";
  const org = actor.organizationId;
  const isShared = resource.buyer_organization_id != null || resource.supplier_organization_id != null;
  const sideOk =
    side === "BUYER" ? resource.buyer_organization_id === org || (!isShared && resource.organization_id === org)
    : side === "SUPPLIER" ? resource.supplier_organization_id === org
    : isShared ? resource.buyer_organization_id === org || resource.supplier_organization_id === org
    : resource.organization_id === org;
  if (!sideOk) return false;

  return holders.some((r) =>
    r.scopeType === "ORGANIZATION" ||
    (r.scopeType === "DEPARTMENT" && r.scopeId != null && r.scopeId === resource.department_id) ||
    (r.scopeType === "LOCATION" && r.scopeId != null && r.scopeId === resource.location_id),
  );
}

/** Lanza 403 si el actor no tiene el permiso (sin recurso) o 404 si el recurso no es visible desde su organización. */
export function authorize(actor: Actor, permission: Permission, resource?: Resource): void {
  if (can(actor, permission, resource)) return;
  if (resource) {
    const org = actor.organizationId;
    const visible = resource.organization_id === org || resource.buyer_organization_id === org || resource.supplier_organization_id === org;
    if (!visible) throw Problem.notFound();
  }
  throw Problem.forbidden(`Requiere el permiso ${permission}`);
}
