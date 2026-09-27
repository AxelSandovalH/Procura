"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Status { departments: number; locations: number; approval_workflows: number; members: number; invitations: number; suppliers: number; clients: number; catalog_items: number; requisitions: number; portal_enabled: boolean }
type Uso = "compro" | "vendo" | "ambos";
interface Item { id: string; title: string; hint: string; href: string; perm: string; done: (s: Status) => boolean; for: "buy" | "sell" | "both" }

const ITEMS: Item[] = [
  { id: "areas", title: "Define tus áreas", hint: "Departamentos y lugares de entrega.", href: "/administracion/estructura", perm: "department.manage", done: (s) => s.departments > 0, for: "buy" },
  { id: "aprobacion", title: "Configura quién aprueba", hint: "Reglas de aprobación por monto.", href: "/administracion/flujos", perm: "approval_workflow.manage", done: (s) => s.approval_workflows > 0, for: "buy" },
  { id: "equipo", title: "Invita a tu equipo", hint: "Comparte el acceso con quien trabaja contigo.", href: "/administracion/miembros", perm: "member.invite", done: (s) => s.members > 1 || s.invitations > 0, for: "both" },
  { id: "proveedor", title: "Conecta con un proveedor", hint: "Búscalo o invítalo con un enlace.", href: "/relaciones", perm: "relationship.request", done: (s) => s.suppliers > 0, for: "buy" },
  { id: "requisicion", title: "Haz tu primera requisición", hint: "Pide lo que necesitas y envíala a aprobación.", href: "/requisiciones/nueva", perm: "requisition.create", done: (s) => s.requisitions > 0, for: "buy" },
  { id: "catalogo", title: "Carga tu catálogo", hint: "Importa desde Excel o CSV. Es privado.", href: "/catalogo/importar", perm: "catalog.import", done: (s) => s.catalog_items > 0, for: "sell" },
  { id: "portal", title: "Activa tu portal", hint: "Un enlace donde tus clientes te piden cotización.", href: "/administracion/organizacion", perm: "settings.manage", done: (s) => s.portal_enabled, for: "sell" },
  { id: "cliente", title: "Conecta con un cliente", hint: "Comparte tu portal o invítalo.", href: "/relaciones", perm: "relationship.request", done: (s) => s.clients > 0, for: "sell" },
];

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/** «Primeros pasos» en Inicio: se completa sola según lo que ya existe en la organización y se puede ocultar. */
export function GettingStarted() {
  const session = useSession();
  const orgId = session.org?.id;
  const [hidden, setHidden] = useState(false);
  const q = useQuery({ queryKey: ["onboarding-status", orgId], queryFn: () => api<Status>("/organization/onboarding-status"), enabled: !!orgId && session.can("organization.read"), staleTime: 30_000 });
  if (!orgId || !q.data || hidden || read(`procura:gs-dismissed:${orgId}`) === "1") return null;

  const uso = (read(`procura:uso:${orgId}`) as Uso | null) ?? "ambos";
  const items = ITEMS.filter((i) => session.can(i.perm) && (i.for === "both" || (i.for === "buy" ? uso !== "vendo" : uso !== "compro")));
  const done = items.filter((i) => i.done(q.data!)).length;
  if (items.length === 0 || done === items.length) return null;

  return (
    <Card className="mb-8">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-semibold">Primeros pasos</h2><p className="text-sm text-muted-foreground">{done} de {items.length} listos. Haz que Procura funcione para tu organización.</p></div>
          <button type="button" aria-label="Ocultar primeros pasos" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { try { localStorage.setItem(`procura:gs-dismissed:${orgId}`, "1"); } catch { /* opcional */ } setHidden(true); }}><X className="size-4" /></button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Progreso de primeros pasos"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / items.length) * 100}%` }} /></div>
        <ul className="divide-y rounded-lg border">
          {items.map((i) => {
            const ok = i.done(q.data!);
            return (
              <li key={i.id}>
                <Link href={i.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", ok ? "border-primary bg-primary text-primary-foreground" : "text-transparent")}><Check className="size-3" /></span>
                  <span className="min-w-0 flex-1"><span className={cn("block text-sm font-medium", ok && "text-muted-foreground line-through")}>{i.title}</span>{!ok && <span className="block text-xs text-muted-foreground">{i.hint}</span>}</span>
                  {!ok && <ChevronRight className="size-4 text-muted-foreground" />}
                </Link>
              </li>);
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
