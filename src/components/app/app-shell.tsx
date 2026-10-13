"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/brand/logo";
import { Splash } from "@/components/brand/splash";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { NotificationBell } from "@/components/app/notification-bell";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { MODULES, moduleFor, sectionActive, visibleSections } from "@/lib/ui/modules";

function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(""); }

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname; // el menú móvil se cierra solo al cambiar de ruta
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  useEffect(() => { if (session.noOrganization) router.replace("/onboarding"); }, [session.noOrganization, router]);

  // Cobro: una organización nueva sin plan es llevada UNA vez a elegirlo; mientras no tenga plan activo ve un aviso.
  const billing = useQuery({ queryKey: ["billing"], queryFn: () => api<{ access: "LEGACY" | "NEW" | "PLAN" | "LAPSED" }>("/billing"), enabled: !session.loading && !session.noOrganization && session.can("organization.read"), staleTime: 60_000, retry: false });
  const needsPlan = billing.data?.access === "NEW" || billing.data?.access === "LAPSED";
  const onPlanPage = pathname.startsWith("/suscripcion");
  useEffect(() => {
    if (billing.data?.access !== "NEW" || onPlanPage || !session.org) return;
    try { const k = `procura-plan-prompt-${session.org.id}`; if (window.localStorage.getItem(k)) return; window.localStorage.setItem(k, "1"); } catch { /* sin almacenamiento: se muestra solo el aviso */ return; }
    router.replace("/suscripcion");
  }, [billing.data?.access, onPlanPage, session.org, router]);

  const canApprove = session.can("requisition.approve");
  const pending = useQuery({ queryKey: ["approvals-pending"], queryFn: () => api<{ data: unknown[] }>("/approvals/pending"), enabled: canApprove, refetchInterval: 60_000 });
  const pendingCount = pending.data?.data.length ?? 0;

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa: descarta toda la caché de la sesión
    window.location.assign("/login");
  }

  if (session.loading || session.noOrganization) {
    return <Splash />;
  }

  // Nueve módulos; cada uno lleva a su primera sección visible.
  const current = moduleFor(pathname);
  const nav = (
    <nav className="space-y-0.5" aria-label="Principal">
      {MODULES.map((m) => {
        const secs = visibleSections(m, session.can);
        if (secs.length === 0) return null;
        const active = current?.id === m.id;
        const badge = m.id === "compras" && pendingCount > 0;
        return (
          <Link key={m.id} href={secs[0]!.href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors", active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
            <m.icon className="size-4" />
            <span className="flex-1">{m.label}</span>
            {badge && <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800" title="Aprobaciones pendientes">{pendingCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
  const tabs = current ? visibleSections(current, session.can) : [];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#contenido" className="sr-only z-50 rounded-lg bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:ring-3 focus:ring-ring/50">Saltar al contenido</a>
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-3 transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-1 pt-1"><Link href="/inicio" aria-label="Procura, ir al inicio"><Logo size={22} textClassName="text-lg" /></Link><Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X /></Button></div>
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
              <DropdownMenuItem render={<Link href="/cuenta" />}>Mi cuenta</DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/restablecer" />}>Cambiar contraseña</DropdownMenuItem>
              <DropdownMenuItem onClick={logout}><LogOut className="size-4" />Cerrar sesión</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {needsPlan && !onPlanPage && <div role="note" className="border-b bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{billing.data?.access === "NEW" ? "Elige un plan para usar todas las funciones de Procura." : "Tu suscripción no está activa."} <Link href="/suscripcion" className="font-medium underline underline-offset-2">Ver planes</Link></div>}
        {tabs.length > 1 && (
          <nav aria-label={current!.label} className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto border-b px-4 pt-3 md:px-6">
            {tabs.map((t) => { const on = sectionActive(pathname, t) && !tabs.some((o) => o.href !== t.href && o.href.length > t.href.length && sectionActive(pathname, o)); return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm", on ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}{t.badge && pendingCount > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{pendingCount}</span>}
              </Link>); })}
          </nav>
        )}
        <main id="contenido" tabIndex={-1} className="mx-auto outline-none w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
