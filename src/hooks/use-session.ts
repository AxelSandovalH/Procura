"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";

export interface Membership { id: string; status: string; is_primary_admin: boolean; title: string | null; organization: { id: string; slug: string; display_name: string }; is_active: boolean }
export interface Me { user: { id: string; email: string; full_name: string }; memberships: Membership[] }
export interface OrgContext {
  organization: { id: string; slug: string; display_name: string; base_currency: string; timezone: string };
  actor: { type: string; membership_id: string | null; permissions: string[] };
}

/** Usuario + organización activa + permisos efectivos. Los permisos solo pintan la UI: la API decide siempre. */
export function useSession() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 60_000 });
  const activeMemberships = (me.data?.memberships ?? []).filter((m) => m.status === "ACTIVE");
  const org = useQuery({
    queryKey: ["org"], queryFn: () => api<OrgContext>("/organization"), staleTime: 60_000, retry: false,
    enabled: me.isSuccess && activeMemberships.length > 0,
  });
  const perms = new Set(org.data?.actor.permissions ?? []);
  return {
    me: me.data, org: org.data?.organization, memberships: activeMemberships,
    can: (p: string) => perms.has(p),
    loading: me.isLoading || (activeMemberships.length > 0 && org.isLoading),
    noOrganization: me.isSuccess && (activeMemberships.length === 0 || (org.error instanceof ApiError && org.error.status === 403)),
    error: me.error ?? (org.error instanceof ApiError && org.error.status === 403 ? null : org.error),
  };
}
