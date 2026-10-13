import { retainedShare } from "@/lib/finance/calc";
import { beforeAll, describe, expect, it } from "vitest";
import { assertFiscalIdentity, decimalToMinor, evaluateInvoice, parseCfdi, type InvoiceContext } from "@/lib/billing/cfdi";
import { FiscalProviderError, withRetry } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

const xml = (o: { uuid?: string | null; tipo?: string; rfcR?: string; rfcE?: string; sub?: string; total?: string; moneda?: string } = {}) => Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="A" Folio="7" Fecha="2026-10-05T12:00:00" SubTotal="${o.sub ?? "1000.00"}" Descuento="10.00" Total="${o.total ?? "1160.00"}" Moneda="${o.moneda ?? "MXN"}" TipoDeComprobante="${o.tipo ?? "I"}" MetodoPago="PUE" FormaPago="03">
  <cfdi:Emisor Rfc="${o.rfcE ?? "AAA010101AAA"}" Nombre="Proveedor"/><cfdi:Receptor Rfc="${o.rfcR ?? "BBB010101BBB"}" Nombre="Comprador"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00"/>
  ${o.uuid === null ? "" : `<cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${o.uuid ?? "11111111-1111-4111-8111-111111111111"}"/></cfdi:Complemento>`}
</cfdi:Comprobante>`);

describe("lectura de CFDI", () => {
  it("extrae folio fiscal, RFC, montos en centavos, método y forma de pago", () => {
    const c = parseCfdi(xml());
    expect(c.fiscalUuid).toBe("11111111-1111-4111-8111-111111111111");
    expect(c.issuerRfc).toBe("AAA010101AAA"); expect(c.receiverRfc).toBe("BBB010101BBB");
    expect(c.subtotalMinor).toBe(BigInt(100000)); expect(c.totalMinor).toBe(BigInt(116000)); expect(c.taxMinor).toBe(BigInt(16000)); expect(c.discountMinor).toBe(BigInt(1000));
    expect(c.paymentMethod).toBe("PUE"); expect(c.paymentForm).toBe("03");
  });
  it("rechaza lo que no es un CFDI timbrado y válido", () => {
    expect(() => parseCfdi(xml({ uuid: null }))).toThrow(/timbrado/);
    expect(() => parseCfdi(Buffer.from("<html/>"))).toThrow();
    expect(() => parseCfdi(Buffer.from(""))).toThrow();
    expect(() => parseCfdi(Buffer.from('<!DOCTYPE x [<!ENTITY a "b">]><cfdi:Comprobante/>'))).toThrow();
    expect(() => parseCfdi(xml({ uuid: "no-es-uuid" }))).toThrow();
  });
  it("convierte decimales a centavos sin errores de coma flotante", () => {
    expect(decimalToMinor("0.1", "x")).toBe(BigInt(10)); expect(decimalToMinor("1234.565", "x")).toBe(BigInt(123457)); expect(decimalToMinor("19.99", "x")).toBe(BigInt(1999));
    expect(() => decimalToMinor("abc", "x")).toThrow(); expect(() => decimalToMinor(undefined, "x")).toThrow();
  });
});

describe("validación contra orden y recepción", () => {
  const ctx = (o: Partial<InvoiceContext> = {}): InvoiceContext => ({ buyerTaxId: "BBB010101BBB", supplierTaxId: "AAA010101AAA", order: { currency: "MXN", totalMinor: BigInt(116000) }, otherInvoicedMinor: BigInt(0), otherInvoicedSubtotalMinor: BigInt(0), receivedSubtotalMinor: BigInt(100000), ...o });
  it("rechaza tipo distinto de ingreso y RFC que no corresponden", () => {
    expect(() => assertFiscalIdentity(parseCfdi(xml({ tipo: "E" })), ctx())).toThrow(/ingreso/);
    expect(() => assertFiscalIdentity(parseCfdi(xml({ rfcR: "CCC010101CCC" })), ctx())).toThrow(/receptor/);
    expect(() => assertFiscalIdentity(parseCfdi(xml({ rfcE: "CCC010101CCC" })), ctx())).toThrow(/emisor/);
    expect(() => assertFiscalIdentity(parseCfdi(xml()), ctx())).not.toThrow();
  });
  it("marca diferencias de importe, moneda y lo recibido", () => {
    expect(evaluateInvoice(parseCfdi(xml()), ctx()).filter((d) => d.severity === "ERROR")).toHaveLength(0);
    expect(evaluateInvoice(parseCfdi(xml({ total: "2000.00" })), ctx()).map((d) => d.code)).toContain("EXCEDE_ORDEN");
    expect(evaluateInvoice(parseCfdi(xml({ moneda: "USD" })), ctx()).map((d) => d.code)).toContain("MONEDA_DISTINTA");
    expect(evaluateInvoice(parseCfdi(xml({ sub: "1500.00", total: "1160.00" })), ctx()).map((d) => d.code)).toContain("EXCEDE_RECIBIDO");
    expect(evaluateInvoice(parseCfdi(xml()), ctx({ receivedSubtotalMinor: null })).map((d) => d.code)).toContain("SIN_RECEPCION");
    expect(evaluateInvoice(parseCfdi(xml()), ctx({ otherInvoicedMinor: BigInt(50000) })).map((d) => d.code)).toContain("EXCEDE_ORDEN");
  });
});

describe("capa fiscal", () => {
  beforeAll(() => { // env() valida las variables obligatorias del servidor; aquí no se toca ninguna base ni proveedor real
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/x"; process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.FISCALAPI_API_KEY; delete process.env.FISCALAPI_TENANT;
  });
  it("el adaptador solo declara lo implementado y sin credenciales falla con el motivo correcto", async () => {
    const p = getFiscalProvider();
    expect(p.capabilities).toMatchObject({ issue: true, fetchIssued: true, fetchReceived: true, statusLookup: true, cancel: true, downloadPdf: true });
    expect(p.isConfigured()).toBe(false);
    const req = { issuerId: "i", series: "A", date: "2026-10-06T10:00:00", currency: "MXN", expeditionZipCode: "01160", paymentFormCode: "03", paymentMethodCode: "PUE" as const, timeZone: "America/Mazatlan",
      recipient: { taxId: "EKU9003173C9", legalName: "X", taxRegimeCode: "601", cfdiUseCode: "G03", zipCode: "42501" }, items: [] };
    await expect(p.issueCfdi(req)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(p.testConnection()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(p.listIssuers()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(p.getCfdiStatus("x")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(p.listDownloadRules()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(p.listDownloadRequests()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it("reintenta solo errores transitorios y respeta el límite de intentos", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new FiscalProviderError("UPSTREAM", "x"); }, { attempts: 3, baseMs: 1 })).rejects.toBeInstanceOf(FiscalProviderError);
    expect(n).toBe(3);
    n = 0;
    await expect(withRetry(async () => { n++; throw new FiscalProviderError("UNAUTHORIZED", "x"); }, { attempts: 3, baseMs: 1 })).rejects.toBeInstanceOf(FiscalProviderError);
    expect(n).toBe(1);
    let ok = 0;
    expect(await withRetry(async () => { if (ok++ < 1) throw new FiscalProviderError("RATE_LIMITED", "x", 0); return "ok"; }, { attempts: 3, baseMs: 1 })).toBe("ok");
  });
});

describe("retenciones (RESICO)", () => {
  const xml = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-10-12T13:10:00" SubTotal="16717.38" Total="17400.00" Moneda="MXN" TipoDeComprobante="I"><cfdi:Emisor Rfc="SAHA040711DH6" Nombre="X"/><cfdi:Receptor Rfc="PYR240827SC0" Nombre="Y"/><cfdi:Impuestos TotalImpuestosRetenidos="1992.16" TotalImpuestosTrasladados="2674.78"><cfdi:Retenciones><cfdi:Retencion Impuesto="002" Importe="1783.19"/><cfdi:Retencion Impuesto="001" Importe="208.97"/></cfdi:Retenciones></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="520C70C4-AAD8-456B-AEA2-2E9B36AED7AC"/></cfdi:Complemento></cfdi:Comprobante>`;
  it("lee el total retenido y el neto", () => {
    const c = parseCfdi(Buffer.from(xml));
    expect(c.retainedMinor).toBe(BigInt(199216)); expect(c.totalMinor).toBe(BigInt(1740000)); expect(c.taxMinor).toBe(BigInt(267478));
    expect(c.subtotalMinor + c.taxMinor - c.retainedMinor).toBe(c.totalMinor); // subtotal + IVA − retenciones = total neto
  });
  it("sin retenciones el retenido es cero", () => { expect(parseCfdi(Buffer.from(xml.replace(' TotalImpuestosRetenidos="1992.16"', ""))).retainedMinor).toBe(BigInt(0)); });
  it("lo retenido es lo documentado por encima del neto del CFDI", () => {
    expect(retainedShare(BigInt(1939216), BigInt(1740000), BigInt(199216))).toBe(BigInt(199216)); // venta en bruto: se retiene todo
    expect(retainedShare(BigInt(1740000), BigInt(1740000), BigInt(199216))).toBe(BigInt(0));      // venta registrada por lo que se cobra: nada que restar
    expect(retainedShare(BigInt(1800000), BigInt(1740000), BigInt(199216))).toBe(BigInt(60000));  // parcial: solo el excedente
    expect(retainedShare(BigInt(2500000), BigInt(1740000), BigInt(199216))).toBe(BigInt(199216)); // nunca más de lo retenido
    expect(retainedShare(BigInt(500000), BigInt(500000), BigInt(0))).toBe(BigInt(0));             // sin retenciones
  });
});
