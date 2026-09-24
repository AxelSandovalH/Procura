import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { withContext } from "@/lib/db/client";
import { supabaseServer } from "@/lib/supabase/server";
import { Problem } from "@/lib/http/problem";
import type { Permission } from "./permissions";

export const ACTIVE_MEMBERSHIP_COOKIE = "procura_membership";

export interface ScopedRole {
  roleId: string;
  scopeType: string;          // ORGANIZATION | DEPARTMENT | LOCATION | ...
  scopeId: string | null;
  permissions: Set<Permission>;
}

export interface Actor {
  type: "USER" | "API_KEY";
  userId: string | null;
  membershipId: string | null;
  apiKeyId: string | null;
  organizationId: string;
  roles: ScopedRole[];
  /** Unión de permisos de todas las asignaciones (para chequeos sin recurso). */
  permissions: Set<Permission>;
}

export interface AuthUser { id: string; email: string; fullName: string }

/** Usuario autenticado por Supabase Auth (cookie). null si no hay sesión. */
export async function currentUser(): Promise<AuthUser | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const profile = await withContext({ userId: data.user.id }, (tx) =>
    tx.public_users.findUnique({ where: { id: data.user!.id }, select: { id: true, email: true, full_name: true } }),
  );
  if (!profile) throw Problem.unauthorized("Perfil de usuario no encontrado");
  return { id: profile.id, email: profile.email, fullName: profile.full_name };
}

export async function requireUser(): Promise<AuthUser> {
  const u = await currentUser();
  if (!u) throw Problem.unauthorized();
  return u;
}

function sha256(s: string) { return createHash("sha256").update(s).digest("hex"); }

/**
 * Resuelve el actor del request:
 *  - `Authorization: Bearer pk_…` → API key de organización (OD-22)
 *  - sesión Supabase + cookie `procura_membership` (o header X-Procura-Organization) → membership activa
 * Lanza 401 si no hay identidad y 403/404 si el contexto de organización no es válido.
 */
export async function requireActor(req: Request): Promise<Actor> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer pk_")) return actorFromApiKey(auth.slice(7));

  const user = await requireUser();
  const cookieStore = await cookies();
  const headerOrg = req.headers.get("x-procura-organization");
  const cookieMembership = cookieStore.get(ACTIVE_MEMBERSHIP_COOKIE)?.value ?? null;

  const membership = await withContext({ userId: user.id }, (tx) =>
    tx.memberships.findFirst({
      where: {
        user_id: user.id,
        status: "ACTIVE",
        ...(headerOrg ? { organization_id: headerOrg } : cookieMembership ? { id: cookieMembership } : {}),
      },
      orderBy: { created_at: "asc" },
      select: { id: true, organization_id: true },
    }),
  );
  if (!membership) throw new Problem(403, "Sin organización activa", "Selecciona una organización (POST /api/v1/me/active-organization) o no eres miembro activo de la indicada");

  const roles = await loadRoles({ userId: user.id, organizationId: membership.organization_id, membershipId: membership.id });
  return {
    type: "USER", userId: user.id, membershipId: membership.id, apiKeyId: null,
    organizationId: membership.organization_id, roles, permissions: union(roles),
  };
}

/**
 * Igual que requireActor(), pero para una organización explícita en vez de la cookie/header —
 * usada en flujos donde el actor especifica a qué organización actúa (ej. aceptar una invitación
 * de relación). Lanza 403 si el usuario no tiene membership ACTIVE en esa organización.
 */
export async function requireActorForOrganization(organizationId: string): Promise<Actor> {
  const user = await requireUser();
  const membership = await withContext({ userId: user.id }, (tx) =>
    tx.memberships.findFirst({ where: { user_id: user.id, organization_id: organizationId, status: "ACTIVE" }, select: { id: true } }),
  );
  if (!membership) throw Problem.forbidden("No eres miembro activo de esa organización");
  const roles = await loadRoles({ userId: user.id, organizationId, membershipId: membership.id });
  return { type: "USER", userId: user.id, membershipId: membership.id, apiKeyId: null, organizationId, roles, permissions: union(roles) };
}

async function actorFromApiKey(raw: string): Promise<Actor> {
  const hash = sha256(raw);
  // La RLS no permite leer api_keys sin contexto de organización, y aún no la conocemos:
  // app.lookup_api_key es SECURITY DEFINER y devuelve solo (id, organization_id) de una key viva.
  const key = await withContext({}, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; organization_id: string }[]>`select id, organization_id from app.lookup_api_key(${hash})`;
    return rows[0] ?? null;
  });
  if (!key) throw Problem.unauthorized("API key inválida, expirada o revocada");

  const roles = await withContext({ organizationId: key.organization_id }, async (tx) => {
    await tx.api_keys.update({ where: { id: key.id }, data: { last_used_at: new Date() } });
    const rows = await tx.api_key_roles.findMany({
      where: { api_key_id: key.id, roles: { is_active: true } },
      select: { role_id: true, roles: { select: { role_permissions: { select: { permission_code: true } } } } },
    });
    return rows.map((r) => ({
      roleId: r.role_id, scopeType: "ORGANIZATION", scopeId: null,
      permissions: new Set(r.roles.role_permissions.map((p) => p.permission_code as Permission)),
    }));
  });
  return { type: "API_KEY", userId: null, membershipId: null, apiKeyId: key.id, organizationId: key.organization_id, roles, permissions: union(roles) };
}

async function loadRoles(ctx: { userId: string; organizationId: string; membershipId: string }): Promise<ScopedRole[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.role_assignments.findMany({
      where: { membership_id: ctx.membershipId, revoked_at: null, roles: { is_active: true } },
      select: { role_id: true, scope_type: true, scope_id: true, roles: { select: { role_permissions: { select: { permission_code: true } } } } },
    });
    return rows.map((r) => ({
      roleId: r.role_id, scopeType: r.scope_type, scopeId: r.scope_id,
      permissions: new Set(r.roles.role_permissions.map((p) => p.permission_code as Permission)),
    }));
  });
}

function union(roles: ScopedRole[]) {
  const s = new Set<Permission>();
  for (const r of roles) for (const p of r.permissions) s.add(p);
  return s;
}
