import type { Tx } from "@/lib/db/client";
import type { supplier_invoices } from "@prisma/client";
import { supabaseAdmin, ATTACHMENTS_BUCKET } from "@/lib/supabase/admin";

export const LIVE_STATUSES = ["VALIDATED", "DISCREPANCY", "ACCEPTED"] as const;

/** Subtotal de lo recibido y aceptado en la orden (cantidad aceptada × precio de la orden); null si no hay recepción confirmada. */
export async function receivedSubtotalMinor(tx: Tx, orderId: string): Promise<bigint | null> {
  const lines = await tx.receipt_lines.findMany({
    where: { receipts: { order_id: orderId, status: { in: ["CONFIRMED", "CONFIRMED_WITH_DISCREPANCIES"] } } },
    select: { quantity_accepted: true, delivery_lines: { select: { order_lines: { select: { unit_price_minor: true } } } } },
  });
  if (lines.length === 0) return null;
  return lines.reduce((acc, l) => acc + BigInt(Math.round(Number(l.quantity_accepted) * Number(l.delivery_lines.order_lines.unit_price_minor))), BigInt(0));
}

/** Resumen de facturación de una orden. */
export async function invoiceSummary(tx: Tx, order: { id: string; total_minor: bigint; subtotal_minor: bigint; currency: string }) {
  const live = await tx.supplier_invoices.findMany({ where: { order_id: order.id, status: { in: [...LIVE_STATUSES] } }, select: { total_minor: true, subtotal_minor: true } });
  const invoiced = live.reduce((a, i) => a + i.total_minor, BigInt(0));
  const invoicedSubtotal = live.reduce((a, i) => a + i.subtotal_minor, BigInt(0));
  return {
    currency: order.currency, order_total_minor: order.total_minor, invoiced_total_minor: invoiced, invoiced_subtotal_minor: invoicedSubtotal,
    pending_to_invoice_minor: order.total_minor > invoiced ? order.total_minor - invoiced : BigInt(0),
    received_subtotal_minor: await receivedSubtotalMinor(tx, order.id),
  };
}

/** Oculta las claves internas de Storage. */
export function publicInvoice(i: supplier_invoices) {
  const { xml_storage_key, pdf_storage_key, ...rest } = i;
  return { ...rest, has_pdf: !!pdf_storage_key, has_xml: !!xml_storage_key };
}

export async function signedInvoiceUrls(i: supplier_invoices, ttl = 300) {
  const st = supabaseAdmin().storage.from(ATTACHMENTS_BUCKET);
  const [xml, pdf] = await Promise.all([
    st.createSignedUrl(i.xml_storage_key, ttl, { download: i.xml_filename }),
    i.pdf_storage_key ? st.createSignedUrl(i.pdf_storage_key, ttl, { download: i.pdf_filename ?? "factura.pdf" }) : Promise.resolve(null),
  ]);
  return { xml_url: xml.data?.signedUrl ?? null, pdf_url: pdf?.data?.signedUrl ?? null, expires_in: ttl };
}
