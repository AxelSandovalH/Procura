import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { route, Problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { emitEvent, notifyPermissionHolders } from "@/lib/events/emit";
import { supabaseAdmin, ensureAttachmentsBucket, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";
import { sanitizeFilename, validateFile } from "@/lib/attachments/validate";
import { assertFiscalIdentity, evaluateInvoice, parseCfdi } from "@/lib/billing/cfdi";
import { invoiceSummary, LIVE_STATUSES, publicInvoice, receivedSubtotalMinor } from "@/lib/billing/invoices";

const INVOICEABLE = ["CONFIRMED", "IN_PROCESS", "COMPLETED"];

export const GET = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "invoice.read");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const order = await tx.orders.findFirst({ where: { id: params.id, OR: [{ buyer_organization_id: actor.organizationId }, { supplier_organization_id: actor.organizationId }] } });
    if (!order) throw Problem.notFound();
    const invoices = await tx.supplier_invoices.findMany({ where: { order_id: order.id }, orderBy: { created_at: "desc" } });
    return { data: invoices.map(publicInvoice), summary: await invoiceSummary(tx, order), perspective: order.buyer_organization_id === actor.organizationId ? "BUYER" : "SUPPLIER" };
  });
  return NextResponse.json(out);
});

/** El proveedor adjunta el CFDI (XML obligatorio, PDF opcional) a una orden suya. Se lee el XML, se valida y se compara con la orden y la recepción. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  await rateLimit("invoice-upload", actor.userId ?? actor.organizationId, { windowSeconds: 3600, max: 60 });
  authorize(actor, "invoice.submit");

  const form = await req.formData();
  const xmlFile = form.get("xml"); const pdfFile = form.get("pdf");
  if (!(xmlFile instanceof File)) throw Problem.badRequest("Falta el archivo XML del CFDI (campo 'xml', multipart/form-data)");
  const xmlBytes = Buffer.from(await xmlFile.arrayBuffer());
  const cfdi = parseCfdi(xmlBytes);
  let pdfBytes: Buffer | null = null; let pdfName: string | null = null;
  if (pdfFile instanceof File && pdfFile.size > 0) {
    pdfBytes = Buffer.from(await pdfFile.arrayBuffer()); pdfName = sanitizeFilename(pdfFile.name);
    validateFile(pdfName, "application/pdf", pdfBytes);
    if (pdfBytes.length > 20 * 1024 * 1024) throw Problem.badRequest("El PDF excede 20 MB");
  }

  const keys: string[] = [];
  try {
    const result = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
      const order = await tx.orders.findFirst({ where: { id: params.id, supplier_organization_id: actor.organizationId } });
      if (!order) throw Problem.notFound();
      if (!INVOICEABLE.includes(order.status)) throw Problem.conflict(`No se puede facturar una orden en estado ${order.status}: primero debe confirmarse.`);

      const [buyer, supplier] = await Promise.all([
        tx.organizations.findUniqueOrThrow({ where: { id: order.buyer_organization_id }, select: { tax_id: true } }),
        tx.organizations.findUniqueOrThrow({ where: { id: order.supplier_organization_id }, select: { tax_id: true } }),
      ]);
      const others = await tx.supplier_invoices.findMany({ where: { order_id: order.id, status: { in: [...LIVE_STATUSES] } }, select: { total_minor: true, subtotal_minor: true } });
      const ctx = {
        buyerTaxId: buyer.tax_id, supplierTaxId: supplier.tax_id, order: { currency: order.currency, totalMinor: order.total_minor },
        otherInvoicedMinor: others.reduce((a, i) => a + i.total_minor, BigInt(0)), otherInvoicedSubtotalMinor: others.reduce((a, i) => a + i.subtotal_minor, BigInt(0)),
        receivedSubtotalMinor: await receivedSubtotalMinor(tx, order.id),
      };
      assertFiscalIdentity(cfdi, ctx);
      const dup = await tx.supplier_invoices.findFirst({ where: { supplier_organization_id: actor.organizationId, fiscal_uuid: cfdi.fiscalUuid, status: { not: "REJECTED" } }, select: { order_id: true } });
      if (dup) throw Problem.conflict(dup.order_id === order.id ? "Esta factura ya está registrada en esta orden." : "Esta factura ya está registrada en otra orden.");
      const discrepancies = evaluateInvoice(cfdi, ctx);

      await ensureAttachmentsBucket();
      const base = `${actor.organizationId}/invoices/${randomUUID()}`;
      const store = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET);
      const upXml = await store.upload(`${base}.xml`, xmlBytes, { contentType: "text/xml", upsert: false });
      if (upXml.error) throw new Problem(502, "Storage no disponible", upXml.error.message);
      keys.push(`${base}.xml`);
      if (pdfBytes) {
        const upPdf = await store.upload(`${base}.pdf`, pdfBytes, { contentType: "application/pdf", upsert: false });
        if (upPdf.error) throw new Problem(502, "Storage no disponible", upPdf.error.message);
        keys.push(`${base}.pdf`);
      }

      const status = discrepancies.some((d) => d.severity === "ERROR") ? "DISCREPANCY" : "VALIDATED";
      const invoice = await tx.supplier_invoices.create({
        data: {
          order_id: order.id, buyer_organization_id: order.buyer_organization_id, supplier_organization_id: order.supplier_organization_id,
          fiscal_uuid: cfdi.fiscalUuid, series: cfdi.series, folio: cfdi.folio, cfdi_version: cfdi.version, issued_at: cfdi.issuedAt,
          issuer_rfc: cfdi.issuerRfc, issuer_name: cfdi.issuerName, receiver_rfc: cfdi.receiverRfc, receiver_name: cfdi.receiverName,
          currency: cfdi.currency, exchange_rate: cfdi.exchangeRate, subtotal_minor: cfdi.subtotalMinor, tax_minor: cfdi.taxMinor, total_minor: cfdi.totalMinor,
          status, discrepancies, xml_storage_key: `${base}.xml`, xml_filename: sanitizeFilename(xmlFile.name || "factura.xml"),
          pdf_storage_key: pdfBytes ? `${base}.pdf` : null, pdf_filename: pdfName, uploaded_by_membership_id: actor.membershipId,
        },
      });
      const label = [cfdi.series, cfdi.folio].filter(Boolean).join("-") || cfdi.fiscalUuid.slice(0, 8);
      const visibleTo = [order.buyer_organization_id, order.supplier_organization_id];
      await audit(tx, { ...auditBase(actor), visibleTo, action: "invoice.submitted", resourceType: "order", resourceId: order.id, resourceLabel: order.order_number, metadata: { invoice_id: invoice.id, fiscal_uuid: cfdi.fiscalUuid, total_minor: cfdi.totalMinor.toString(), status } });
      const payload = { invoice: { id: invoice.id, fiscal_uuid: cfdi.fiscalUuid, total_minor: cfdi.totalMinor, currency: cfdi.currency, status }, order: { id: order.id, order_number: order.order_number } };
      await emitEvent(tx, { type: "invoice.submitted", aggregateType: "order", aggregateId: order.id, actor, recipients: [
        { organizationId: order.buyer_organization_id, perspective: "BUYER", payload }, { organizationId: order.supplier_organization_id, perspective: "SUPPLIER", payload }] });
      await notifyPermissionHolders(tx, { organizationId: order.buyer_organization_id, permission: "invoice.read", type: "invoice.submitted",
        title: status === "DISCREPANCY" ? `Factura ${label} de ${order.order_number} con diferencias` : `Nueva factura ${label} de ${order.order_number}`, resourceType: "order", resourceId: order.id });
      return { invoice: publicInvoice(invoice), discrepancies };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (keys.length) await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).remove(keys).catch(() => {});
    throw err;
  }
});
