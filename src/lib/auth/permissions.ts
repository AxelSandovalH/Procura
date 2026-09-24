/** Catálogo de permisos (espejo de la tabla `permissions`; la BD es la fuente de verdad). */
export const PERMISSIONS = [
  "organization.read","organization.update","settings.manage","department.manage","location.manage",
  "member.read","member.invite","member.approve","member.manage","role.read","role.manage","role.assign",
  "admin.transfer_primary","audit.read","api_key.manage","webhook.manage","approval_workflow.manage",
  "relationship.read","relationship.request","relationship.accept","relationship.manage",
  "catalog.read","catalog.manage","catalog.import","catalog.share","shared_catalog.read",
  "requisition.read","requisition.read_all","requisition.create","requisition.update","requisition.update_any",
  "requisition.submit","requisition.cancel","requisition.close","requisition.approve","requisition.read_private",
  "template.manage","rfq.issue","quotation.read","quotation.accept","order.read","order.cancel","order.close_short",
  "receipt.confirm","rfq.read","rfq.decline","quotation.submit","quotation.read_private","order.confirm","order.start",
  "delivery.register","conversation.shared.read","conversation.shared.post","note.internal.read","note.internal.post",
  "attachment.upload","attachment.delete_own",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Side = "BUYER" | "SUPPLIER" | "ANY";

/** Lado desde el que tiene sentido cada permiso sobre recursos compartidos (RBAC.md §2). */
export const PERMISSION_SIDE: Partial<Record<Permission, Side>> = {
  "catalog.share": "SUPPLIER", "shared_catalog.read": "BUYER",
  "requisition.read": "BUYER", "requisition.read_all": "BUYER", "requisition.create": "BUYER",
  "requisition.update": "BUYER", "requisition.update_any": "BUYER", "requisition.submit": "BUYER",
  "requisition.cancel": "BUYER", "requisition.close": "BUYER", "requisition.approve": "BUYER",
  "requisition.read_private": "BUYER", "template.manage": "BUYER", "rfq.issue": "BUYER",
  "quotation.read": "BUYER", "quotation.accept": "BUYER", "order.close_short": "BUYER", "receipt.confirm": "BUYER",
  "rfq.read": "SUPPLIER", "rfq.decline": "SUPPLIER", "quotation.submit": "SUPPLIER",
  "quotation.read_private": "SUPPLIER", "order.confirm": "SUPPLIER", "order.start": "SUPPLIER", "delivery.register": "SUPPLIER",
};
