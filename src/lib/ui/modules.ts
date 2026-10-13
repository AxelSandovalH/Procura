import { BookOpen, CreditCard, FileText, Handshake, Landmark, LineChart, Settings, ShoppingCart, TrendingUp, type LucideIcon } from "lucide-react";

/**
 * Los nueve módulos de Procura. Cada uno agrupa rutas que ya existen; `sections` son las pestañas que se ven dentro del módulo.
 * El menú lateral muestra un módulo si la persona puede ver al menos una de sus secciones, y lleva a la primera visible.
 */
export interface Section { href: string; label: string; perm?: string | null; alt?: string[]; badge?: boolean }
export interface AppModule { id: string; label: string; icon: LucideIcon; /** rutas que pertenecen al módulo (resalta el menú) */ prefixes: string[]; sections: Section[] }

export const MODULES: AppModule[] = [
  {
    id: "compras", label: "Compras", icon: ShoppingCart, prefixes: ["/gastos", "/comprar", "/requisiciones", "/aprobaciones", "/solicitudes", "/cotizaciones", "/ordenes"],
    sections: [
      { href: "/gastos", label: "Gastos", perm: "expense.read" },
      { href: "/comprar", label: "Comprar", perm: "requisition.create" },
      { href: "/requisiciones", label: "Requisiciones", perm: "requisition.read" },
      { href: "/aprobaciones", label: "Aprobaciones", perm: "requisition.approve", badge: true },
      { href: "/solicitudes", label: "Cotizaciones", perm: "rfq.read", alt: ["rfq.issue"] },
      { href: "/ordenes", label: "Órdenes", perm: "order.read" },
    ],
  },
  { id: "ventas", label: "Ventas", icon: TrendingUp, prefixes: ["/ventas"], sections: [{ href: "/ventas", label: "Ventas", perm: "sale.read" }] },
  { id: "facturas", label: "Facturas", icon: FileText, prefixes: ["/facturas"], sections: [{ href: "/facturas", label: "Facturas", perm: "cfdi.read" }] },
  { id: "banco", label: "Conciliación bancaria", icon: Landmark, prefixes: ["/banco"], sections: [{ href: "/banco", label: "Conciliación bancaria", perm: "finance.read" }] },
  {
    id: "finanzas", label: "Finanzas", icon: LineChart, prefixes: ["/finanzas"],
    sections: [{ href: "/finanzas", label: "Resumen", perm: "finance.read" }, { href: "/finanzas/exportaciones", label: "Exportaciones", perm: "finance.read" }],
  },
  {
    id: "relaciones", label: "Relaciones", icon: Handshake, prefixes: ["/relaciones"],
    sections: [{ href: "/relaciones", label: "Proveedores y clientes en Procura", perm: "relationship.read" }, { href: "/relaciones/clientes", label: "Clientes para facturar", perm: "sale.read" }],
  },
  { id: "suscripcion", label: "Suscripción", icon: CreditCard, prefixes: ["/suscripcion"], sections: [{ href: "/suscripcion", label: "Suscripción", perm: "organization.read" }] },
  { id: "catalogo", label: "Catálogo", icon: BookOpen, prefixes: ["/catalogo"], sections: [{ href: "/catalogo", label: "Catálogo", perm: "catalog.read" }] },
  {
    id: "administracion", label: "Administración", icon: Settings, prefixes: ["/administracion"],
    sections: [{ href: "/administracion", label: "Administración", perm: "member.read", alt: ["role.read", "department.manage", "location.manage", "approval_workflow.manage", "organization.update", "settings.manage"] }],
  },
];

const inPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
/** Módulo al que pertenece una ruta (o null: p. ej. Inicio o Mi cuenta). */
export const moduleFor = (pathname: string): AppModule | null => MODULES.find((m) => m.prefixes.some((p) => inPrefix(pathname, p))) ?? null;
/** Secciones que la persona puede ver según sus permisos. */
export const visibleSections = (m: AppModule, can: (p: string) => boolean): Section[] => m.sections.filter((s) => !s.perm || can(s.perm) || (s.alt ?? []).some(can));
/** Rutas de las secciones del módulo que se resaltan como activas. */
export const sectionActive = (pathname: string, s: Section) => inPrefix(pathname, s.href);
