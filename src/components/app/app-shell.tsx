"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, CheckSquare, Home, Inbox, Package, Handshake, BookOpen, LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { NotificationBell } from "@/components/app/notification-bell";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Solo lo implementado: nada de enlaces muertos. Cada ítem se muestra si el actor tiene el permiso. */
const NAV = [
  { href: "/inicio", label: "Inicio", icon: Home, perm: null },
  { href: "/requisiciones", label: "Requisiciones", icon: ClipboardList, perm: "requisition.read" },
  { href: "/aprobaciones", label: "Aprobaciones", icon: CheckSquare, perm: "requisition.approve", badge: true },
  { href: "/solicitudes", label: "Cotizaciones", icon: Inbox, perm: "rfq.read", alt: "rfq.issue" },
  { href: "/ordenes", label: "Órdenes", icon: Package, perm: "order.read" },
  { href: "/relaciones", label: "Relaciones", icon: Handshake, perm: "relationship.read" },
  { href: "/catalogo", label: "Catálogo", icon: BookOpen, perm: "catalog.read" },
] as const;

function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(""); }

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => { if (session.noOrganization) router.replace("/onboarding"); }, [session.noOrganization, router]);

  const canApprove = session.can("requisition.approve");
  const pending = useQuery({ queryKey: ["approvals-pending"], queryFn: () => api<{ data: unknown[] }>("/approvals/pending"), enabled: canApprove, refetchInterval: 60_000 });
  const pendingCount = pending.data?.data.length ?? 0;

  async function logout() { await api("/auth/logout", { method: "POST" }); window.location.assign("/login"); }

  if (session.loading || session.noOrganization) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const nav = (
    <nav className="space-y-0.5" aria-label="Principal">
      {NAV.filter((i) => !i.perm || session.can(i.perm) || (("alt" in i) && session.can(i.alt))).map((i) => {
        const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors", active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
            <i.icon className="size-4" />
            <span className="flex-1">{i.label}</span>
            {"badge" in i && i.badge && pendingCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{pendingCount}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-3 transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-1 pt-1"><span className="text-lg font-semibold tracking-tight">Procura</span><Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></Button></div>
        <OrgSwitcher />
        {nav}
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu /></Button>
          <div className="flex-1" />
          <NotificationBell />
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Cuenta" />}>
              <Avatar><AvatarFallback>{initials(session.me?.user.full_name ?? "?")}</AvatarFallback></Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup><DropdownMenuLabel className="font-normal"><p className="text-sm font-medium">{session.me?.user.full_name}</p><p className="truncate text-xs text-muted-foreground">{session.me?.user.email}</p></DropdownMenuLabel></DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}><LogOut className="size-4" />Cerrar sesión</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
