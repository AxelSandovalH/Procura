import type { Tx } from "@/lib/db/client";
import type { ParsedCfdi } from "@/lib/billing/cfdi";
import { Problem } from "@/lib/http/problem";
import { linkWaitingExpenses } from "@/lib/finance/ops";
import { supabaseAdmin, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";

export interface StoredFiles { xmlKey: string | null; xmlName: string | null; pdfKey: string | null; pdfName: string | null }

/** Crea la copia del CFDI de una organización (única fuente de verdad del dato fiscal para ella). */
export async function createCfdiDocument(tx: Tx, p: { organizationId: string; membershipId: string | null; direction: "ISSUED" | "RECEIVED"; cfdi: ParsedCfdi; source: "MANUAL_UPLOAD" | "SUPPLIER_ORDER" | "PROVIDER_SYNC" | "PROVIDER_ISSUED"; files: StoredFiles }) {
  const dup = await tx.cfdi_documents.findFirst({ where: { organization_id: p.organizationId, fiscal_uuid: p.cfdi.fiscalUuid }, select: { id: true, direction: true } });
  if (dup) throw Problem.conflict("Este CFDI ya está registrado en tu organización.");
  const c = p.cfdi;
  const doc = await tx.cfdi_documents.create({ data: {
    organization_id: p.organizationId, direction: p.direction, fiscal_uuid: c.fiscalUuid, cfdi_version: c.version, cfdi_type: c.type || "I", series: c.series, folio: c.folio, issued_at: c.issuedAt,
    issuer_rfc: c.issuerRfc, issuer_name: c.issuerName, receiver_rfc: c.receiverRfc, receiver_name: c.receiverName, currency: c.currency, exchange_rate: c.exchangeRate,
    subtotal_minor: c.subtotalMinor, discount_minor: c.discountMinor, tax_minor: c.taxMinor, total_minor: c.totalMinor, fiscal_payment_method: c.paymentMethod, fiscal_payment_form: c.paymentForm,
    xml_storage_key: p.files.xmlKey, xml_filename: p.files.xmlName, pdf_storage_key: p.files.pdfKey, pdf_filename: p.files.pdfName, source: p.source, created_by_membership_id: p.membershipId,
  } });
  // Gastos que subieron la factura en PDF y esperaban este XML: se ligan solos.
  if (p.direction === "RECEIVED") await linkWaitingExpenses(tx, p.organizationId, p.membershipId, c.fiscalUuid);
  return doc;
}

/** Datos del CFDI sin claves de Storage. */
export function publicCfdi<T extends { xml_storage_key: string | null; pdf_storage_key: string | null }>(d: T) {
  const { xml_storage_key, pdf_storage_key, ...rest } = d;
  return { ...rest, has_xml: !!xml_storage_key, has_pdf: !!pdf_storage_key };
}

export async function signedCfdiUrls(d: { xml_storage_key: string | null; xml_filename: string | null; pdf_storage_key: string | null; pdf_filename: string | null }, ttl = 300) {
  const st = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET);
  const [xml, pdf] = await Promise.all([
    d.xml_storage_key ? st.createSignedUrl(d.xml_storage_key, ttl, { download: d.xml_filename ?? "cfdi.xml" }) : null,
    d.pdf_storage_key ? st.createSignedUrl(d.pdf_storage_key, ttl, { download: d.pdf_filename ?? "cfdi.pdf" }) : null,
  ]);
  return { xml_url: xml?.data?.signedUrl ?? null, pdf_url: pdf?.data?.signedUrl ?? null, expires_in: ttl };
}

/**
 * El comprador conserva su propia copia (RECEIVED) de cada factura que un proveedor adjunta a sus órdenes. Se crea aquí, en su
 * contexto, la primera vez que se necesita (el proveedor no puede escribir en las tablas del comprador). Idempotente.
 */
export async function materializeReceived(tx: Tx, organizationId: string, membershipId: string | null) {
  const pending = await tx.supplier_invoices.findMany({ where: { buyer_organization_id: organizationId, buyer_cfdi_id: null, status: { not: "REJECTED" } } });
  for (const inv of pending) {
    const existing = await tx.cfdi_documents.findFirst({ where: { organization_id: organizationId, fiscal_uuid: inv.fiscal_uuid }, select: { id: true } });
    const id = existing?.id ?? (await tx.cfdi_documents.create({ data: {
      organization_id: organizationId, direction: "RECEIVED", fiscal_uuid: inv.fiscal_uuid, cfdi_version: inv.cfdi_version, cfdi_type: "I", series: inv.series, folio: inv.folio, issued_at: inv.issued_at,
      issuer_rfc: inv.issuer_rfc, issuer_name: inv.issuer_name, receiver_rfc: inv.receiver_rfc, receiver_name: inv.receiver_name, currency: inv.currency, exchange_rate: inv.exchange_rate,
      subtotal_minor: inv.subtotal_minor, tax_minor: inv.tax_minor, total_minor: inv.total_minor, xml_storage_key: inv.xml_storage_key, xml_filename: inv.xml_filename,
      pdf_storage_key: inv.pdf_storage_key, pdf_filename: inv.pdf_filename, source: "SUPPLIER_ORDER", created_by_membership_id: membershipId,
    } })).id;
    await tx.supplier_invoices.update({ where: { id: inv.id }, data: { buyer_cfdi_id: id } });
  }
  return pending.length;
}
