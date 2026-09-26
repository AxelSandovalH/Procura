"use client";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import Link from "next/link";

export function OrgSwitcher() {
  const { org, memberships } = useSession();
  async function switchTo(id: string) {
    if (id === org?.id) return;
    await api("/me/active-organization", { body: { organization_id: id } });
    window.location.assign("/inicio"); // contexto nuevo = estado limpio: nada de caché de otra organización
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 py-2 text-left text-sm hover:bg-sidebar-accent" />}>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"><Building2 className="size-3.5" /></span>
        <span className="min-w-0 flex-1 truncate font-medium">{org?.display_name ?? "…"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizaciones</DropdownMenuLabel>
        {memberships.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => switchTo(m.organization.id)}>
            <span className="min-w-0 flex-1 truncate">{m.organization.display_name}</span>
            {m.organization.id === org?.id && <Check className="size-4" />}
          </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/onboarding" />}>Crear otra organización</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
