/** Frases en español para las acciones de auditoría (`audit_logs.action`). Lo no listado se humaniza. */
const LABELS: Record<string, string> = {
  "requisition.created": "creó la solicitud", "requisition.updated": "editó la solicitud", "requisition.submitted": "envió la solicitud",
  "requisition.approval_requested": "envió la compra elegida a aprobación", "requisition.approved": "aprobó la compra",
  "requisition.rejected": "rechazó la compra", "requisition.changes_requested": "pidió cambios", "requisition.withdrawn": "retiró la solicitud de aprobación",
  "requisition.cancelled": "canceló la solicitud", "requisition.closed": "cerró la solicitud", "requisition.duplicated": "duplicó la solicitud",
  "requisition_concept.created": "agregó un concepto", "requisition_concept.updated": "editó un concepto", "requisition_concept.deleted": "quitó un concepto",
  "rfq.issued": "pidió cotización", "rfq.viewed": "abrió la solicitud de cotización", "rfq.declined": "declinó cotizar", "rfq.withdrawn": "retiró la solicitud de cotización",
  "rfq.auto_issue_skipped": "no pudo pedir cotización automáticamente",
  "quotation.created": "empezó una cotización", "quotation.submitted": "envió su cotización", "quotation.revised": "revisó su cotización", "quotation.extended": "extendió la vigencia de su cotización",
  "quotation.withdrawn": "retiró su cotización", "quotation.accepted": "eligió la cotización", "quotation.rejected": "rechazó la cotización",
  "order.created": "generó la orden", "order.confirmed": "confirmó la orden", "order.started": "comenzó la orden", "order.rejected": "rechazó la orden",
  "order.cancelled": "canceló la orden", "order.completed": "completó la orden",
  "delivery.created": "registró una entrega", "delivery.updated": "actualizó una entrega", "delivery.cancelled": "canceló una entrega", "receipt.confirmed": "confirmó la recepción",
};
/** Acciones de detalle interno que no aportan a una línea de tiempo legible. */
export const AUDIT_NOISE = ["read", "quotation.updated", "quotation_private.updated", "quotation_line.created", "quotation_line.updated", "quotation_line.deleted"];

export function auditLabel(action: string): string {
  return LABELS[action] ?? action.replace(/[._]/g, " ");
}
