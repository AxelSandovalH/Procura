"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/hooks/use-session";
import { ADMIN_TABS } from "@/lib/ui/admin-tabs";
import { cn } from "@/lib/utils";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const tabs = ADMIN_TABS.filter((t) => t.perms.some((p) => session.can(p)));
  return (
    <>
      <PageHeader title="Administración" description="Personas, permisos y reglas de tu organización." />
      {tabs.length === 0 && !session.loading ? <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">No tienes permisos de administración.</div> : (
        <>
          <nav aria-label="Administración" className="mb-6 flex gap-1 overflow-x-auto border-b">
            {tabs.map((t) => {
              const active = pathname === t.href;
              return <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</Link>;
            })}
          </nav>
          {children}
        </>
      )}
    </>
  );
}
