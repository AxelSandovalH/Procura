import { BookOpen, Boxes, ClipboardList, FileSearch, GitBranch, Handshake, History, KeyRound, Layers, Link2, Network, PackageCheck, Plug, ScrollText, Server, Settings2, Shield, ShoppingCart, Store, Truck, UserCog, Users, Webhook, Workflow, Wrench, type LucideIcon } from "lucide-react";
import type { Plan } from "./pricing-data";

export type PlanId = Plan["id"];
/** Orden de los planes: un módulo «desde» un plan está en ese plan y en los superiores. */
export const PLAN_ORDER: PlanId[] = ["starter", "business", "enterprise", "custom"];

export interface Area { id: string; title: string; text: string; icon: LucideIcon }
export interface Module { id: string; area: string; name: string; text: string; icon: LucideIcon; from: PlanId }

export const AREAS: Area[] = [
  { id: "compras", title: "Compras", text: "De la necesidad a la orden.", icon: ShoppingCart },
  { id: "aprobaciones", title: "Aprobaciones", text: "Quién autoriza qué.", icon: Shield },
  { id: "proveedores", title: "Proveedores y catálogo", text: "Con quién compras y qué venden.", icon: Handshake },
  { id: "entrega", title: "Entrega y control", text: "Lo recibido y su registro.", icon: Truck },
  { id: "integraciones", title: "Integraciones", text: "Procura conectado con tus sistemas.", icon: Plug },
  { id: "escala", title: "Escala y servicios", text: "Para operaciones grandes o a la medida.", icon: Layers },
];

/** Módulos por área. Solo lo que Procura ofrece hoy o es un servicio de implementación; no se agregan funciones inexistentes. */
export const MODULES: Module[] = [
  // Compras
  { id: "requisiciones", area: "compras", name: "Requisiciones", text: "Pide lo que necesitas con conceptos, prioridad y fecha. Duplica pedidos anteriores.", icon: ClipboardList, from: "starter" },
  { id: "cotizaciones", area: "compras", name: "Cotizaciones", text: "Solicita cotización a tus proveedores y recibe sus respuestas, con versiones.", icon: FileSearch, from: "starter" },
  { id: "comparativo", area: "compras", name: "Comparativo de proveedores", text: "Compara las cotizaciones lado a lado por concepto, con el menor precio resaltado.", icon: Workflow, from: "starter" },
  { id: "ordenes", area: "compras", name: "Órdenes de compra", text: "Al aceptar una cotización, la orden se genera sola con sus líneas y precios.", icon: ScrollText, from: "starter" },
  // Aprobaciones
  { id: "flujos", area: "aprobaciones", name: "Flujos de aprobación", text: "Define quién aprueba cada requisición según su monto.", icon: GitBranch, from: "starter" },
  { id: "multinivel", area: "aprobaciones", name: "Aprobaciones multinivel", text: "Varios niveles por monto, con aprobador por rol, persona o jefe de área.", icon: Network, from: "business" },
  { id: "areas", area: "aprobaciones", name: "Múltiples áreas y departamentos", text: "Reglas y permisos por departamento y ubicación.", icon: Boxes, from: "business" },
  { id: "roles", area: "aprobaciones", name: "Roles y permisos avanzados", text: "Roles propios con permisos a la medida y alcance por área.", icon: UserCog, from: "business" },
  // Proveedores y catálogo
  { id: "proveedores", area: "proveedores", name: "Gestión de proveedores", text: "Relaciones aceptadas por ambas partes, con términos y contactos.", icon: Handshake, from: "starter" },
  { id: "portal", area: "proveedores", name: "Portal de proveedores", text: "Un enlace público donde tus clientes te piden cotización.", icon: Store, from: "starter" },
  { id: "catalogo", area: "proveedores", name: "Catálogo", text: "Tu catálogo privado, con importación desde Excel o CSV.", icon: BookOpen, from: "starter" },
  { id: "catalogos-proveedor", area: "proveedores", name: "Catálogos por proveedor", text: "Comparte con cada cliente solo lo que quieras, y consulta lo que tus proveedores comparten.", icon: Link2, from: "business" },
  { id: "ilimitados", area: "proveedores", name: "Proveedores ilimitados", text: "Sin tope en el número de proveedores conectados.", icon: Users, from: "business" },
  // Entrega y control
  { id: "recepcion", area: "entrega", name: "Recepción de compras", text: "Confirma lo recibido y registra discrepancias, línea por línea.", icon: PackageCheck, from: "starter" },
  { id: "historial", area: "entrega", name: "Historial y bitácora", text: "Cada acción importante queda registrada con su motivo, quién y cuándo.", icon: History, from: "starter" },
  { id: "parciales", area: "entrega", name: "Entregas parciales", text: "El proveedor entrega por partes y tú recibes cada una por separado.", icon: Truck, from: "business" },
  // Integraciones
  { id: "api", area: "integraciones", name: "API", text: "La misma API de la aplicación: crea requisiciones y consulta órdenes y entregas.", icon: KeyRound, from: "business" },
  { id: "webhooks", area: "integraciones", name: "Webhooks", text: "Avisos firmados y con reintentos para que tu sistema se entere de cada evento.", icon: Webhook, from: "business" },
  { id: "erp", area: "integraciones", name: "Integraciones con ERP", text: "Conectamos Procura con tu ERP para originar y seguir compras desde ahí.", icon: Plug, from: "enterprise" },
  // Escala y servicios
  { id: "usuarios", area: "escala", name: "Usuarios ampliables", text: "Crece más allá del límite de usuarios del plan.", icon: Users, from: "enterprise" },
  { id: "sucursales", area: "escala", name: "Organizaciones y sucursales", text: "Varias organizaciones y ubicaciones bajo una misma operación.", icon: Boxes, from: "enterprise" },
  { id: "avanzados", area: "escala", name: "Flujos de aprobación avanzados", text: "Reglas de aprobación más finas para estructuras complejas.", icon: Settings2, from: "enterprise" },
  { id: "onboarding", area: "escala", name: "Onboarding personalizado", text: "Te acompañamos en la puesta en marcha con tu equipo.", icon: UserCog, from: "enterprise" },
  { id: "medida", area: "escala", name: "Integraciones a medida", text: "Conexiones con tus sistemas, diseñadas para tu operación.", icon: Wrench, from: "custom" },
  { id: "especiales", area: "escala", name: "Flujos especiales y automatizaciones", text: "Procesos y automatizaciones propios de tu empresa.", icon: Workflow, from: "custom" },
  { id: "migracion", area: "escala", name: "Migración de datos", text: "Llevamos tu información actual a Procura.", icon: Layers, from: "custom" },
  { id: "modulos", area: "escala", name: "Desarrollo de módulos", text: "Módulos nuevos construidos para tus procesos.", icon: Wrench, from: "custom" },
  { id: "dedicada", area: "escala", name: "Infraestructura dedicada", text: "Un entorno exclusivo para tu organización.", icon: Server, from: "custom" },
];

/** ¿El módulo está incluido en el plan? (planes acumulativos: cada uno incluye los anteriores). */
export const isIncluded = (m: Module, plan: PlanId) => PLAN_ORDER.indexOf(m.from) <= PLAN_ORDER.indexOf(plan);
