import type { Permission } from "@/lib/auth/permissions";

/** Etiquetas en español y agrupación para el editor de roles. La BD sigue siendo la fuente de verdad de los códigos. */
export const PERMISSION_GROUPS: { title: string; items: Record<string, string> }[] = [
  { title: "Organización", items: {
    "organization.read": "Ver la organización", "organization.update": "Editar datos de la organización", "settings.manage": "Gestionar configuración",
    "department.manage": "Gestionar departamentos", "location.manage": "Gestionar ubicaciones", "audit.read": "Ver bitácora de auditoría",
    "api_key.manage": "Gestionar llaves de API", "webhook.manage": "Gestionar webhooks", "approval_workflow.manage": "Configurar flujos de aprobación" } },
  { title: "Personas y roles", items: {
    "member.read": "Ver miembros", "member.invite": "Invitar miembros", "member.approve": "Aprobar solicitudes de ingreso", "member.manage": "Suspender, reactivar y quitar miembros",
    "role.read": "Ver roles", "role.manage": "Crear y editar roles", "role.assign": "Asignar roles", "admin.transfer_primary": "Transferir la administración principal" } },
  { title: "Relaciones y catálogo", items: {
    "relationship.read": "Ver relaciones", "relationship.request": "Solicitar relaciones", "relationship.accept": "Aceptar relaciones", "relationship.manage": "Gestionar relaciones",
    "catalog.read": "Ver catálogo propio", "catalog.manage": "Gestionar catálogo propio", "catalog.import": "Importar catálogo", "catalog.share": "Compartir catálogo (proveedor)", "shared_catalog.read": "Ver catálogo compartido (comprador)" } },
  { title: "Compras (comprador)", items: {
    "requisition.read": "Ver requisiciones propias", "requisition.read_all": "Ver todas las requisiciones", "requisition.create": "Crear requisiciones", "requisition.update": "Editar requisiciones propias",
    "requisition.update_any": "Editar cualquier requisición", "requisition.submit": "Enviar a aprobación", "requisition.cancel": "Cancelar requisiciones", "requisition.close": "Cerrar requisiciones",
    "requisition.approve": "Aprobar requisiciones", "requisition.read_private": "Ver presupuesto y precios estimados", "template.manage": "Gestionar plantillas",
    "rfq.issue": "Solicitar cotizaciones", "quotation.read": "Ver cotizaciones recibidas", "quotation.accept": "Aceptar o rechazar cotizaciones",
    "order.read": "Ver órdenes", "order.cancel": "Cancelar órdenes", "order.close_short": "Cerrar órdenes con faltante", "receipt.confirm": "Confirmar recepciones" } },
  { title: "Ventas (proveedor)", items: {
    "rfq.read": "Ver solicitudes recibidas", "rfq.decline": "Declinar solicitudes", "quotation.submit": "Cotizar y enviar cotizaciones", "quotation.read_private": "Ver costos y notas internas de cotización",
    "order.confirm": "Confirmar órdenes", "order.start": "Iniciar órdenes", "delivery.register": "Registrar entregas" } },
  { title: "Colaboración", items: {
    "conversation.shared.read": "Leer conversaciones compartidas", "conversation.shared.post": "Escribir en conversaciones compartidas", "note.internal.read": "Leer notas internas",
    "note.internal.post": "Escribir notas internas", "attachment.upload": "Subir adjuntos", "attachment.delete_own": "Borrar adjuntos propios" } },
];

export const permissionLabel = (code: Permission | string): string => {
  for (const g of PERMISSION_GROUPS) if (code in g.items) return g.items[code]!;
  return code;
};
