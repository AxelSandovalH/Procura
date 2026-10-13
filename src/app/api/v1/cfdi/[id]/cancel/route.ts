import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { idempotent } from "@/lib/http/idempotency";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { assertCancelable } from "@/lib/billing/cancel";

const Body = z.object({
  reason_code: z.enum(["01", "02", "03"], { message: "Elige el motivo: 01, 02 o 03" }),
  replacement_uuid: z.uuid("El folio fiscal del CFDI que sustituye no es válido").optional(),
  confirm: z.literal(true, { message: "Confirma que entiendes que no se puede deshacer" }),
}).refine((b) => b.reason_code !== "01" || !!b.replacement_uuid, { message: "Con el motivo 01 indica el CFDI que sustituye", path: ["replacement_uuid"] });

/**
 * Solicita al SAT (vía el proveedor) la cancelación de un CFDI emitido desde Procura. Motivos: 01 con sustitución (hay que indicar el CFDI que lo sustituye),
 * 02 con errores sin relación, 03 la operación no se realizó. No es inmediata: queda «Cancelando» hasta que el SAT confirma, y puede volver a «Vigente» si el receptor la rechaza.
 */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const body = await json(req, (d) => Body.parse(d));
  const provider = getFiscalProvider();
  return idempotent(req, actor, { id: params.id, ...body }, async () => {
    const ctx = { userId: actor.userId, organizationId: actor.organizationId };
    const doc = await withContext(ctx, async (tx) => {
      const d = await tx.cfdi_documents.findFirst({ where: { id: params.id, organization_id: actor.organizationId } });
      if (!d) throw Problem.notFound();
      assertCancelable(d);
      if (body.reason_code === "01") {
        if (body.replacement_uuid!.toUpperCase() === d.fiscal_uuid.toUpperCase()) throw Problem.badRequest("El CFDI que sustituye no puede ser el mismo.");
        const rep = await tx.cfdi_documents.findFirst({ where: { organization_id: actor.organizationId, direction: "ISSUED", fiscal_uuid: { equals: body.replacement_uuid!, mode: "insensitive" } }, select: { sat_status: true } });
        if (!rep) throw Problem.badRequest("El CFDI que sustituye debe ser uno emitido por tu organización y registrado en Procura. Emítelo primero.");
        if (rep.sat_status === "CANCELADO" || rep.sat_status === "CANCELANDO") throw Problem.badRequest("El CFDI que sustituye está cancelado.");
      }
      return d;
    });
    if (!provider.isConfigured()) throw new Problem(409, "Proveedor fiscal", "El proveedor fiscal no está configurado en el servidor.");
    let result;
    try { result = await provider.cancelCfdi({ providerInvoiceId: doc.provider_external_id!, reasonCode: body.reason_code, replacementUuid: body.replacement_uuid?.toUpperCase() }); }
    catch (e) { if (e instanceof FiscalProviderError) throw new Problem(502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
    const out = await withContext(ctx, async (tx) => {
      const u = await tx.cfdi_documents.update({ where: { id: doc.id }, data: { sat_status: "CANCELANDO", cancel_reason_code: body.reason_code, cancel_replacement_uuid: body.replacement_uuid?.toUpperCase() ?? null, cancel_requested_at: new Date(), cancel_requested_by: actor.membershipId, sat_status_checked_at: new Date(), updated_at: new Date() } });
      await audit(tx, { ...auditBase(actor), action: "cfdi.cancellation_requested", resourceType: "cfdi", resourceId: doc.id, resourceLabel: doc.fiscal_uuid, metadata: { reason_code: body.reason_code, replacement_uuid: body.replacement_uuid ?? null, sat_code: result.satCode, environment: provider.environment() } });
      return { id: u.id, sat_status: u.sat_status, sat_code: result.satCode, environment: provider.environment() };
    });
    return { status: 202, body: out };
  });
});
