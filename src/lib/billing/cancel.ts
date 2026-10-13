import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";
import { audit } from "@/lib/audit";
import { recomputeCfdi, recomputeExpense, recomputeSale } from "@/lib/finance/ops";
import { FiscalProviderError, type InvoiceState } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

/** Un CFDI emitido por Procura con el proveedor actual y todavía vigente puede cancelarse. */
export function assertCancelable(d: { direction: string; cfdi_type: string; provider: string | null; provider_external_id: string | null; sat_status: string }) {
  if (d.direction !== "ISSUED") throw Problem.badRequest("Solo se cancela un CFDI emitido por tu organización.");
  if (!d.provider_external_id || d.provider !== getFiscalProvider().name) throw Problem.conflict("Este CFDI no se emitió desde Procura, así que no se puede cancelar desde aquí. Cancélalo en el portal del SAT o con tu contador.");
  if (d.sat_status === "CANCELADO") throw Problem.conflict("El CFDI ya está cancelado.");
  if (d.sat_status === "CANCELANDO") throw Problem.conflict("La cancelación de este CFDI ya está en proceso.");
}

/** Aplica el estado que reporta el proveedor. Al confirmarse la cancelación, las ventas ligadas dejan de contarlo como documentado. */
export async function applyInvoiceState(tx: Tx, organizationId: string, membershipId: string | null, cfdiId: string, state: InvoiceState): Promise<string> {
  const d = await tx.cfdi_documents.findFirstOrThrow({ where: { id: cfdiId, organization_id: organizationId } });
  if (state === "UNKNOWN" || d.sat_status === state) { await tx.cfdi_documents.update({ where: { id: d.id }, data: { sat_status_checked_at: new Date() } }); return d.sat_status; }
  await tx.cfdi_documents.update({ where: { id: d.id }, data: { sat_status: state, sat_status_checked_at: new Date(), updated_at: new Date(), ...(state === "CANCELADO" ? { cancelled_at: new Date() } : {}), ...(state === "VIGENTE" ? { cancel_reason_code: null, cancel_replacement_uuid: null, cancel_requested_at: null, cancel_requested_by: null } : {}) } });
  if (state === "CANCELADO") {
    for (const l of await tx.cfdi_links.findMany({ where: { cfdi_id: d.id }, select: { sale_id: true, expense_id: true } })) {
      if (l.sale_id) await recomputeSale(tx, l.sale_id); if (l.expense_id) await recomputeExpense(tx, l.expense_id);
    }
    await recomputeCfdi(tx, d.id);
  }
  await audit(tx, { actorType: membershipId ? "USER" : "SYSTEM", membershipId, organizationId, action: state === "CANCELADO" ? "cfdi.cancelled" : state === "VIGENTE" ? "cfdi.cancellation_rejected" : "cfdi.status_changed", resourceType: "cfdi", resourceId: d.id, resourceLabel: d.fiscal_uuid, metadata: { from: d.sat_status, to: state } });
  return state;
}

/** Consulta el estado de un CFDI emitido y lo aplica. Devuelve el estado resultante. */
export async function refreshInvoiceState(tx: Tx, organizationId: string, membershipId: string | null, cfdiId: string): Promise<{ state: string; raw: string; cancelable: string | null }> {
  const d = await tx.cfdi_documents.findFirst({ where: { id: cfdiId, organization_id: organizationId } });
  if (!d) throw Problem.notFound();
  if (!d.provider_external_id || d.provider !== getFiscalProvider().name) throw Problem.conflict("Este CFDI no se emitió desde Procura: su estado no se puede consultar aquí.");
  let st; try { st = await getFiscalProvider().invoiceStatus(d.provider_external_id); } catch (e) { if (e instanceof FiscalProviderError) throw new Problem(502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
  return { state: await applyInvoiceState(tx, organizationId, membershipId, d.id, st.state), raw: st.raw, cancelable: st.cancelable };
}
