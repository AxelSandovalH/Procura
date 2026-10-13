import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { sales } from "@prisma/client";
import { Problem } from "@/lib/http/problem";
import { withContext, type Tx } from "@/lib/db/client";
import { audit, type AuditEntry } from "@/lib/audit";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { parseCfdi } from "@/lib/billing/cfdi";
import { createCfdiDocument } from "@/lib/billing/cfdi-docs";
import { linkCfdi } from "@/lib/finance/ops";
import { saleView } from "@/lib/finance/views";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { tryGeneratePdf, type StoredPdf } from "@/lib/billing/cfdi-pdf";
import { addLedger, availableCredits, creditsRequired } from "@/lib/billing/credits";
import { assertFeature } from "@/lib/billing/entitlements";

export const IssueBody = z.object({
  payment_form_code: z.string().regex(/^\d{2}$/, "La forma de pago SAT son 2 dígitos (01, 03, 04…)"),
  payment_method_code: z.enum(["PUE", "PPD"]),
  recipient: z.object({
    tax_id: z.string().trim().min(12).max(13), legal_name: z.string().trim().min(1).max(250), tax_regime_code: z.string().regex(/^\d{3}$/),
    zip_code: z.string().regex(/^\d{5}$/), cfdi_use_code: z.string().regex(/^[A-Z]\d{2}$/), email: z.string().email().optional(),
  }).optional(),
  save_recipient: z.boolean().default(false),
  /** Retenciones que el cliente (persona moral) hace al emisor: ISR 1.25% (RESICO) e IVA 2/3. Las decide quien emite, con su contador. */
  retentions: z.object({ isr: z.boolean().default(false), iva: z.boolean().default(false) }).default({ isr: false, iva: false }),
  lines: z.array(z.object({ line_id: z.uuid(), product_code: z.string().regex(/^\d{8}$/).optional(), unit_code: z.string().regex(/^[A-Z0-9]{2,3}$/).optional() })).default([]),
});
export type IssueBodyInput = z.infer<typeof IssueBody>;

/** Tasas de retención: ISR de RESICO persona física (1.25%) e IVA de dos terceras partes (10.6667%). */
export const RETENTION_RATES = { isr: 0.0125, iva: 0.106667 } as const;

/** Hora local del emisor, AAAA-MM-DDThh:mm:ss, unos minutos atrás para no caer en «fecha futura». */
function localStamp(timeZone: string) {
  const d = new Date(Date.now() - 3 * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export interface IssueSaleInput {
  organizationId: string; userId: string | null; membershipId: string | null; saleId: string; body: IssueBodyInput;
  /** Quién figura en la auditoría (usuario, o el sistema cuando lo pide el público desde el portal). */
  auditBase: Pick<AuditEntry, "actorType" | "actorId" | "membershipId" | "apiKeyId" | "organizationId">;
  source?: "USER" | "PORTAL"; requester?: { email?: string; ipHash?: string };
  /** Validaciones extra dentro de la misma transacción que reserva la emisión (p. ej. plazo y tope diario del portal). */
  precheck?: (tx: Tx, sale: sales) => Promise<void>;
}

/**
 * Emite el CFDI de ingreso de una venta con el proveedor fiscal y lo liga a ella. Solo la venta completa; un solo timbrado por venta.
 * Lo usan la ruta interna (persona con sesión) y el portal público de autofacturación: una sola ruta de emisión, con los mismos candados.
 */
export async function issueSaleCfdi(input: IssueSaleInput) {
  const { organizationId, userId, membershipId, saleId, body } = input;
  const provider = getFiscalProvider();
  const ctx = { userId: userId ?? undefined, organizationId };
  await assertFeature(organizationId, "issuing");

  // 1) Validar y reservar (un bloqueo evita el doble timbrado ante un reintento o doble clic).
  const prep = await withContext(ctx, async (tx) => {
    // Serializa las emisiones de la organización mientras se reserva: dos a la vez no pueden gastar el mismo crédito.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${organizationId}))`;
    const sale = await tx.sales.findFirst({ where: { id: saleId, organization_id: organizationId } });
    if (!sale) throw Problem.notFound();
    if (sale.voided_at) throw Problem.conflict("La venta está anulada");
    if (sale.documented_minor > BigInt(0)) throw Problem.conflict("La venta ya tiene CFDI ligados; desvincúlalos antes de emitir uno nuevo.");
    if (sale.total_minor <= BigInt(0)) throw Problem.badRequest("No se puede facturar una venta de total cero");
    const conn = await tx.fiscal_provider_connections.findUnique({ where: { organization_id_provider: { organization_id: organizationId, provider: provider.name } } });
    const cfg = (conn?.settings ?? {}) as { expedition_zip_code?: string; series?: string; default_product_code?: string; default_unit_code?: string; time_zone?: string };
    if (!conn?.external_account_id || !cfg.expedition_zip_code) throw Problem.conflict("Falta configurar el emisor fiscal (Administración → Organización → Facturación electrónica).");
    const customer = sale.customer_id ? await tx.customers.findFirst({ where: { id: sale.customer_id } }) : null;
    const rec = body.recipient ?? (customer?.tax_id && customer.tax_regime_code && customer.zip_code && customer.cfdi_use_code
      ? { tax_id: customer.tax_id, legal_name: customer.name, tax_regime_code: customer.tax_regime_code, zip_code: customer.zip_code, cfdi_use_code: customer.cfdi_use_code, email: customer.email ?? undefined } : null);
    if (!rec) throw Problem.badRequest("Faltan los datos fiscales del receptor (RFC, razón social, régimen, código postal y uso de CFDI).");
    if ((body.retentions.isr || body.retentions.iva) && rec.tax_id.trim().length !== 12) throw Problem.badRequest("Las retenciones solo aplican cuando el receptor es persona moral (RFC de 12 caracteres).");
    const lines = await tx.sale_lines.findMany({ where: { sale_id: sale.id }, orderBy: { line_number: "asc" } });
    const over = new Map(body.lines.map((l) => [l.line_id, l]));
    const missing: string[] = [];
    const resolved = lines.map((l) => {
      const o = over.get(l.id); const product = o?.product_code ?? l.sat_product_code ?? cfg.default_product_code; const unit = o?.unit_code ?? l.sat_unit_code ?? cfg.default_unit_code;
      if (!product || !unit) missing.push(l.description);
      return { l, product: product!, unit: unit! };
    });
    if (missing.length) throw Problem.badRequest(`Faltan la clave de producto/servicio o de unidad SAT en: ${missing.join(", ")}.`);
    const live = await tx.fiscal_issue_requests.findFirst({ where: { sale_id: sale.id, status: { in: ["PENDING", "DONE"] } }, select: { status: true } });
    if (live) throw Problem.conflict(live.status === "DONE" ? "Esta venta ya fue facturada." : "Ya hay una emisión en curso para esta venta; espera su resultado.");
    // Créditos de timbrado: si la organización los usa, debe tener al menos uno disponible (saldo menos emisiones en curso). Se descuentan SOLO tras un timbrado exitoso.
    const needsCredit = await creditsRequired(tx, organizationId);
    if (needsCredit && (await availableCredits(tx, organizationId)) < 1) throw new Problem(402, "Sin créditos de timbrado", "No hay créditos de timbrado disponibles. Compra un paquete en Administración → Plan.", { code: "NO_CREDITS" });
    if (input.precheck) await input.precheck(tx, sale);
    if (body.save_recipient && body.recipient && customer) await tx.customers.update({ where: { id: customer.id }, data: { tax_id: body.recipient.tax_id.toUpperCase(), tax_regime_code: body.recipient.tax_regime_code, zip_code: body.recipient.zip_code, cfdi_use_code: body.recipient.cfdi_use_code, email: body.recipient.email ?? customer.email, updated_at: new Date() } });
    for (const r of resolved) await tx.sale_lines.update({ where: { id: r.l.id }, data: { sat_product_code: r.product, sat_unit_code: r.unit } });
    const reqRow = await tx.fiscal_issue_requests.create({ data: { organization_id: organizationId, sale_id: sale.id, provider: provider.name, status: "PENDING", created_by_membership_id: membershipId, source: input.source ?? "USER", requester_email: input.requester?.email ?? null, requester_ip_hash: input.requester?.ipHash ?? null } });
    return { sale, needsCredit, reqRow, rec, resolved, cfg, issuerId: conn.external_account_id, series: cfg.series ?? "A" };
  });

  const settle = (status: "FAILED" | "DONE", data: { error?: string; provider_invoice_id?: string; cfdi_id?: string }) => withContext(ctx, (tx) => tx.fiscal_issue_requests.update({ where: { id: prep.reqRow.id }, data: { status, ...data, updated_at: new Date() } }));

  // 2) Timbrar con el proveedor (fuera de cualquier transacción).
  let issued;
  try {
    const tz = prep.cfg.time_zone ?? "America/Mazatlan";
    issued = await provider.issueCfdi({
      issuerId: prep.issuerId, series: prep.series, date: localStamp(tz), currency: prep.sale.currency, expeditionZipCode: prep.cfg.expedition_zip_code!,
      paymentFormCode: body.payment_form_code, paymentMethodCode: body.payment_method_code, timeZone: tz,
      recipient: { taxId: prep.rec.tax_id.toUpperCase(), legalName: prep.rec.legal_name, taxRegimeCode: prep.rec.tax_regime_code, cfdiUseCode: prep.rec.cfdi_use_code, zipCode: prep.rec.zip_code, email: prep.rec.email },
      items: prep.resolved.map(({ l, product, unit }) => ({ sku: `L${l.line_number}`, productCode: product, unitCode: unit, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unit_price_minor) / 100, discount: Number(l.discount_minor) / 100, taxRate: Number(l.tax_rate),
        withholdings: [...(body.retentions.isr ? [{ taxCode: "001" as const, rate: RETENTION_RATES.isr }] : []), ...(body.retentions.iva ? [{ taxCode: "002" as const, rate: RETENTION_RATES.iva }] : [])] })),
    });
  } catch (e) {
    const msg = e instanceof FiscalProviderError ? e.message : "Error inesperado al timbrar.";
    await settle("FAILED", { error: msg });
    if (e instanceof FiscalProviderError) throw new Problem(e.code === "NOT_CONFIGURED" ? 409 : e.code === "RATE_LIMITED" ? 429 : 502, "Proveedor fiscal", msg, { code: e.code });
    throw e;
  }
  // Ya hay un CFDI timbrado: de aquí en adelante nunca se libera el bloqueo sin dejar rastro del id del proveedor.
  await withContext(ctx, (tx) => tx.fiscal_issue_requests.update({ where: { id: prep.reqRow.id }, data: { provider_invoice_id: issued.providerInvoiceId, updated_at: new Date() } }));
  if (!issued.xml) { await settle("DONE", { provider_invoice_id: issued.providerInvoiceId, error: "Timbrada sin XML en la respuesta: descárgala del panel del proveedor y cárgala en Facturas." }); throw new Problem(502, "Proveedor fiscal", `La factura se timbró (id ${issued.providerInvoiceId}) pero la respuesta no trajo el XML; cárgalo manualmente en Facturas.`); }

  // 3) Guardar el XML, registrar el CFDI y ligarlo a la venta.
  const keys: string[] = [];
  try {
    const parsed = parseCfdi(issued.xml);
    await ensureAttachmentsBucket();
    const key = `${organizationId}/cfdi/${randomUUID()}.xml`;
    const up = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).upload(key, issued.xml, { contentType: "text/xml", upsert: false });
    if (up.error) throw new Problem(502, "Storage no disponible", up.error.message);
    keys.push(key);
    const out = await withContext(ctx, async (tx) => {
      const doc = await createCfdiDocument(tx, { organizationId, membershipId, direction: "ISSUED", cfdi: parsed, source: "PROVIDER_ISSUED",
        files: { xmlKey: key, xmlName: `${parsed.fiscalUuid}.xml`, pdfKey: null, pdfName: null } });
      await tx.cfdi_documents.update({ where: { id: doc.id }, data: { provider: provider.name, provider_external_id: issued.providerInvoiceId, sat_status: "VIGENTE", sat_status_checked_at: new Date(), last_synced_at: new Date() } });
      await linkCfdi(tx, organizationId, membershipId, "sale", prep.sale.id, doc.id);
      await tx.fiscal_issue_requests.update({ where: { id: prep.reqRow.id }, data: { status: "DONE", cfdi_id: doc.id, provider_invoice_id: issued.providerInvoiceId, updated_at: new Date() } });
      if (prep.needsCredit) await addLedger(tx, organizationId, -1, "CONSUME", prep.reqRow.id, `Timbrado de ${prep.sale.folio}`);
      await audit(tx, { ...input.auditBase, action: "cfdi.issued", resourceType: "sale", resourceId: prep.sale.id, resourceLabel: prep.sale.folio, metadata: { cfdi_id: doc.id, fiscal_uuid: parsed.fiscalUuid, provider: provider.name, provider_invoice_id: issued.providerInvoiceId, total_minor: parsed.totalMinor.toString(), source: input.source ?? "USER" } });
      return { sale: await saleView(tx, await tx.sales.findUniqueOrThrow({ where: { id: prep.sale.id } })), cfdi: { id: doc.id, fiscal_uuid: parsed.fiscalUuid, xml_key: key, xml: issued.xml! } };
    });
    // El PDF no bloquea la factura: si el proveedor no responde, se genera después desde Facturas.
    const pdf: StoredPdf | null = await tryGeneratePdf(organizationId, out.cfdi.id);
    return { ...out, pdf };
  } catch (e) {
    if (keys.length) await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).remove(keys).catch(() => {});
    // El CFDI SÍ está timbrado: se conserva el bloqueo (PENDING con provider_invoice_id) para recuperarlo, no se emite otro.
    await withContext(ctx, (tx) => tx.fiscal_issue_requests.update({ where: { id: prep.reqRow.id }, data: { error: `Timbrada (UUID ${issued.fiscalUuid ?? "desconocido"}) pero no se pudo registrar en Procura: ${(e as Error).message}`.slice(0, 500), updated_at: new Date() } })).catch(() => {});
    throw e;
  }
}
