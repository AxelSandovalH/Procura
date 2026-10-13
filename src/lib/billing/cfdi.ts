import { XMLParser } from "fast-xml-parser";
import { Problem } from "@/lib/http/problem";

/** Datos fiscales leídos de un CFDI (v3.3 / v4.0). Montos en unidades menores (centavos). */
export interface ParsedCfdi {
  version: string;
  type: string;                 // I ingreso, E egreso, T traslado, N nómina, P pago
  fiscalUuid: string;
  series: string | null;
  folio: string | null;
  issuedAt: Date | null;
  issuerRfc: string; issuerName: string | null;
  receiverRfc: string; receiverName: string | null;
  currency: string;
  exchangeRate: number | null;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  discountMinor: bigint;
  paymentMethod: string | null;   // PUE / PPD
  paymentForm: string | null;     // clave SAT de forma de pago
}

const MAX_XML_BYTES = 2 * 1024 * 1024;

/** Decimal textual → centavos, redondeando a la mitad hacia arriba, sin pasar por coma flotante. */
export function decimalToMinor(text: string | number | undefined | null, field: string): bigint {
  if (text === undefined || text === null || text === "") throw Problem.badRequest(`El CFDI no trae ${field}`);
  const m = String(text).trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) throw Problem.badRequest(`El CFDI trae un valor inválido en ${field}`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = BigInt(m[2]!) * BigInt(100) + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += BigInt(1);
  return m[1] === "-" ? -cents : cents;
}

const attr = (node: unknown, name: string): string | null => {
  const v = (node as Record<string, unknown> | undefined)?.[name];
  return v === undefined || v === null || v === "" ? null : String(v);
};

export function parseCfdi(xml: Buffer): ParsedCfdi {
  if (xml.length === 0) throw Problem.badRequest("El XML está vacío");
  if (xml.length > MAX_XML_BYTES) throw Problem.badRequest("El XML excede 2 MB");
  const text = xml.toString("utf8").replace(/^﻿/, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Problem.badRequest("El XML no es un CFDI válido");
  let doc: Record<string, unknown>;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true, parseAttributeValue: false, parseTagValue: false, processEntities: false }).parse(text);
  } catch {
    throw Problem.badRequest("El archivo no es un XML bien formado");
  }
  const root = doc.Comprobante as Record<string, unknown> | undefined;
  if (!root) throw Problem.badRequest("El XML no es un CFDI (falta el nodo Comprobante)");

  const tfd = (root.Complemento as Record<string, unknown> | undefined)?.TimbreFiscalDigital;
  const fiscalUuid = attr(Array.isArray(tfd) ? tfd[0] : tfd, "UUID");
  if (!fiscalUuid) throw Problem.badRequest("El CFDI no está timbrado (no trae folio fiscal UUID)");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fiscalUuid)) throw Problem.badRequest("El folio fiscal (UUID) del CFDI no es válido");

  const issuerRfc = attr(root.Emisor, "Rfc"), receiverRfc = attr(root.Receptor, "Rfc");
  if (!issuerRfc || !receiverRfc) throw Problem.badRequest("El CFDI no trae el RFC del emisor o del receptor");

  const dateText = attr(root, "Fecha");
  const issuedAt = dateText && !isNaN(Date.parse(dateText)) ? new Date(dateText) : null;
  const tc = attr(root, "TipoCambio");
  const taxText = attr(root.Impuestos, "TotalImpuestosTrasladados");
  return {
    version: attr(root, "Version") ?? attr(root, "version") ?? "",
    type: attr(root, "TipoDeComprobante") ?? "",
    fiscalUuid: fiscalUuid.toUpperCase(),
    series: attr(root, "Serie"), folio: attr(root, "Folio"), issuedAt,
    issuerRfc: issuerRfc.toUpperCase(), issuerName: attr(root.Emisor, "Nombre"),
    receiverRfc: receiverRfc.toUpperCase(), receiverName: attr(root.Receptor, "Nombre"),
    currency: (attr(root, "Moneda") ?? "MXN").toUpperCase(),
    exchangeRate: tc && !isNaN(Number(tc)) ? Number(tc) : null,
    subtotalMinor: decimalToMinor(attr(root, "SubTotal"), "SubTotal"),
    taxMinor: taxText ? decimalToMinor(taxText, "impuestos trasladados") : BigInt(0),
    totalMinor: decimalToMinor(attr(root, "Total"), "Total"),
    discountMinor: attr(root, "Descuento") ? decimalToMinor(attr(root, "Descuento"), "Descuento") : BigInt(0),
    paymentMethod: attr(root, "MetodoPago"), paymentForm: attr(root, "FormaPago"),
  };
}

export type Discrepancy = { code: string; severity: "ERROR" | "WARN"; message: string };

export interface InvoiceContext {
  buyerTaxId: string | null;
  supplierTaxId: string | null;
  order: { currency: string; totalMinor: bigint };
  /** Suma de las otras facturas vivas (validadas, con diferencia o aceptadas) de la misma orden. */
  otherInvoicedMinor: bigint;
  /** Subtotal de lo recibido y aceptado (cantidad aceptada × precio de la orden); null si aún no hay recepción. */
  receivedSubtotalMinor: bigint | null;
  otherInvoicedSubtotalMinor: bigint;
}

/** Tolerancia por redondeo entre líneas: $1.00. */
export const TOLERANCE_MINOR = BigInt(100);

/** Rechazos duros: una factura dirigida a otro RFC o emitida por otro no sirve y debe reemitirse. */
export function assertFiscalIdentity(c: ParsedCfdi, ctx: InvoiceContext) {
  if (c.type !== "I") throw Problem.badRequest(`Solo se aceptan facturas de ingreso (tipo I); el CFDI es de tipo ${c.type || "desconocido"}`);
  if (ctx.buyerTaxId && c.receiverRfc !== ctx.buyerTaxId.toUpperCase()) throw Problem.badRequest(`El RFC receptor del CFDI (${c.receiverRfc}) no corresponde al del comprador (${ctx.buyerTaxId.toUpperCase()})`);
  if (ctx.supplierTaxId && c.issuerRfc !== ctx.supplierTaxId.toUpperCase()) throw Problem.badRequest(`El RFC emisor del CFDI (${c.issuerRfc}) no corresponde al de tu organización (${ctx.supplierTaxId.toUpperCase()})`);
}

/** Diferencias contra la orden y la recepción. ERROR deja la factura «con diferencia»; WARN es solo informativo. */
export function evaluateInvoice(c: ParsedCfdi, ctx: InvoiceContext): Discrepancy[] {
  const out: Discrepancy[] = [];
  const fmt = (m: bigint) => `$${(Number(m) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
  if (!ctx.buyerTaxId) out.push({ code: "RFC_COMPRADOR_SIN_REGISTRAR", severity: "WARN", message: "El comprador no tiene RFC registrado en Procura: no se pudo comprobar el RFC receptor." });
  if (!ctx.supplierTaxId) out.push({ code: "RFC_PROVEEDOR_SIN_REGISTRAR", severity: "WARN", message: "El proveedor no tiene RFC registrado en Procura: no se pudo comprobar el RFC emisor." });
  if (c.currency !== ctx.order.currency) out.push({ code: "MONEDA_DISTINTA", severity: "ERROR", message: `La factura está en ${c.currency} y la orden en ${ctx.order.currency}.` });
  else {
    const invoiced = ctx.otherInvoicedMinor + c.totalMinor;
    if (invoiced > ctx.order.totalMinor + TOLERANCE_MINOR) out.push({ code: "EXCEDE_ORDEN", severity: "ERROR", message: `Lo facturado (${fmt(invoiced)}) excede el total de la orden (${fmt(ctx.order.totalMinor)}).` });
    if (ctx.receivedSubtotalMinor === null) out.push({ code: "SIN_RECEPCION", severity: "WARN", message: "Aún no hay recepción confirmada para comparar contra lo recibido." });
    else {
      const invoicedSub = ctx.otherInvoicedSubtotalMinor + c.subtotalMinor;
      if (invoicedSub > ctx.receivedSubtotalMinor + TOLERANCE_MINOR) out.push({ code: "EXCEDE_RECIBIDO", severity: "ERROR", message: `El subtotal facturado (${fmt(invoicedSub)}) excede lo recibido y aceptado (${fmt(ctx.receivedSubtotalMinor)}).` });
    }
  }
  return out;
}
