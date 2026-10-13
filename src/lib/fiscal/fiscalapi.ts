import { env } from "@/lib/env";
import { FiscalProviderError, type FiscalCapabilities, type FiscalProvider, type IssueRequest, type IssuedCfdi, type ProviderIssuer } from "@/lib/fiscal/provider";

/**
 * Adaptador de Fiscalapi.
 *
 * VERIFICADO contra su documentación oficial (docs.fiscalapi.com): la autenticación va en los encabezados X-API-KEY y X-TENANT-KEY
 * (más X-TIME-ZONE); URLs base https://test.fiscalapi.com (pruebas) y https://live.fiscalapi.com (producción); versión de ruta /api/v4;
 * listado GET /api/v4/invoices?pageNumber=&pageSize=. Solo se implementa lo verificado: la prueba de conexión.
 * NO verificado todavía (rutas exactas de crear/obtener/cancelar/PDF/XML y estructura de emisores y certificados), así que emitir y
 * recuperar siguen sin implementarse.
 *
 * Sin FISCALAPI_URL se usa el ambiente de PRUEBAS: producción exige configurarlo explícitamente.
 */
class FiscalapiProvider implements FiscalProvider {
  readonly name = "fiscalapi";
  readonly capabilities: FiscalCapabilities = { issue: true, fetchIssued: false, fetchReceived: false, statusLookup: false, downloadXml: false, downloadPdf: false };
  get notes() {
    const out = ["Implementado: prueba de conexión, listado de emisores y emisión de factura de ingreso (el XML timbrado se guarda en Procura). Falta verificar y construir: cancelación, consulta de estado, PDF y recuperación de CFDI emitidos y recibidos."];
    if (!this.isConfigured()) out.push("Faltan las variables de entorno FISCALAPI_API_KEY y FISCALAPI_TENANT en el servidor.");
    out.push("Cada empresa debe autorizar el acceso a su información fiscal; las credenciales de una no permiten consultar las de otra.");
    return out;
  }
  environment(): "test" | "live" | "custom" { const b = this.baseUrl(); return b === "https://test.fiscalapi.com" ? "test" : b === "https://live.fiscalapi.com" ? "live" : "custom"; }
  isConfigured() { const e = env(); return !!(e.FISCALAPI_API_KEY && e.FISCALAPI_TENANT); }
  private unsupported(what: string): never {
    throw new FiscalProviderError(this.isConfigured() ? "NOT_SUPPORTED" : "NOT_CONFIGURED", `${what}: ${this.isConfigured() ? "aún no implementado en el adaptador de Fiscalapi" : "el proveedor fiscal no está configurado"}.`);
  }
  /** Ambiente al que apunta este servidor, para diagnosticar credenciales cruzadas (pruebas contra producción). */
  private envLabel() { const b = this.baseUrl(); return b === "https://test.fiscalapi.com" ? "ambiente de pruebas" : b === "https://live.fiscalapi.com" ? "ambiente de producción" : `ambiente ${b}`; }
  private baseUrl() { return (env().FISCALAPI_URL ?? "https://test.fiscalapi.com").replace(/\/+$/, ""); }
  private async request(method: "GET" | "POST", path: string, body?: unknown, timeZone = "America/Mazatlan"): Promise<{ status: number; json: unknown }> {
    if (!this.isConfigured()) throw new FiscalProviderError("NOT_CONFIGURED", "Faltan FISCALAPI_API_KEY y FISCALAPI_TENANT en el servidor.");
    const e = env();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, { method, headers: { "X-API-KEY": e.FISCALAPI_API_KEY!, "X-TENANT-KEY": e.FISCALAPI_TENANT!, "X-TIME-ZONE": timeZone, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    } catch { throw new FiscalProviderError("UPSTREAM", "No se pudo contactar a Fiscalapi (red o tiempo de espera)."); }
    // 401 = credenciales; un 403 puede ser otra cosa (p. ej. saldo insuficiente): se deja pasar para mostrar el motivo que da el proveedor.
    if (res.status === 401) throw new FiscalProviderError("UNAUTHORIZED", `Fiscalapi (${this.envLabel()}) rechazó las credenciales: la API key o el TID no corresponden a ese ambiente.`);
    if (res.status === 429) throw new FiscalProviderError("RATE_LIMITED", "Fiscalapi limitó las peticiones; reintenta en unos segundos.", Number(res.headers.get("retry-after")) || undefined);
    const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
    return { status: res.status, json };
  }
  /** Lista una página mínima de facturas: llamada de solo lectura, verificada, que valida URL, API key y tenant. */
  async testConnection() {
    const r = await this.request("GET", "/api/v4/invoices?pageNumber=1&pageSize=1");
    if (r.status < 200 || r.status >= 300) throw new FiscalProviderError("UPSTREAM", `Fiscalapi respondió ${r.status}.`);
    const base = this.baseUrl();
    return { ok: true as const, environment: base === "https://test.fiscalapi.com" ? "test" as const : base === "https://live.fiscalapi.com" ? "live" as const : "custom" as const };
  }
  /** GET /api/v4/people (documentado como «Listar emisores»). */
  async listIssuers(): Promise<ProviderIssuer[]> {
    const r = await this.request("GET", "/api/v4/people?pageNumber=1&pageSize=50");
    if (r.status < 200 || r.status >= 300) throw new FiscalProviderError("UPSTREAM", `Fiscalapi respondió ${r.status} al listar emisores.`);
    const items = ((r.json as { data?: { items?: Record<string, unknown>[] } } | null)?.data?.items ?? []);
    return items.map((p) => ({ id: String(p.id), legalName: String(p.legalName ?? ""), taxId: String(p.tin ?? ""), taxRegimeCode: p.satTaxRegimeId ? String(p.satTaxRegimeId) : null, zipCode: p.zipCode ? String(p.zipCode) : null }));
  }
  /**
   * POST /api/v4/invoices con el emisor por referencia (su id, con certificados ya cargados en el proveedor) y receptor y conceptos
   * por valores. Respuesta: data.id, data.uuid y data.responses[].invoiceBase64 (XML en base64). Los errores del proveedor se devuelven
   * con su mensaje, que el usuario necesita para corregir datos fiscales.
   */
  async issueCfdi(req: IssueRequest): Promise<IssuedCfdi> {
    const body = {
      versionCode: "4.0", typeCode: "I", series: req.series, date: req.date, currencyCode: req.currency, exchangeRate: 1, exportCode: "01",
      expeditionZipCode: req.expeditionZipCode, paymentFormCode: req.paymentFormCode, paymentMethodCode: req.paymentMethodCode,
      issuer: { id: req.issuerId },
      recipient: { tin: req.recipient.taxId, legalName: req.recipient.legalName, taxRegimeCode: req.recipient.taxRegimeCode, cfdiUseCode: req.recipient.cfdiUseCode, zipCode: req.recipient.zipCode, ...(req.recipient.email ? { email: req.recipient.email } : {}) },
      items: req.items.map((i) => ({
        itemCode: i.productCode, itemSku: i.sku, quantity: i.quantity, unitOfMeasurementCode: i.unitCode, description: i.description, unitPrice: i.unitPrice, discount: i.discount, taxObjectCode: "02",
        itemTaxes: [{ taxCode: "002", taxTypeCode: "Tasa", taxRate: i.taxRate, taxFlagCode: "T" }],
      })),
    };
    const r = await this.request("POST", "/api/v4/invoices", body, req.timeZone);
    const j = r.json as { succeeded?: boolean; message?: string; details?: unknown; data?: { id?: string; uuid?: string | null; responses?: { invoiceUuid?: string; invoiceBase64?: string }[] } } | null;
    if (r.status < 200 || r.status >= 300 || j?.succeeded === false) {
      // El proveedor explica qué dato falla: errores por campo en data[] (propertyName / errorMessage) o un texto en details. No contiene credenciales.
      const fieldErrors = Array.isArray((j as { data?: unknown } | null)?.data) ? ((j as { data: { propertyName?: string; errorMessage?: string }[] }).data.map((e) => `${e.propertyName ?? "campo"}: ${e.errorMessage ?? ""}`).join("; ")) : "";
      const detail = fieldErrors || (typeof j?.details === "string" ? j.details : "") || j?.message || "";
      throw new FiscalProviderError("UPSTREAM", `Fiscalapi no pudo timbrar (${r.status}): ${detail || "sin detalle"}`.slice(0, 900));
    }
    const resp = j?.data?.responses?.[0];
    const id = j?.data?.id;
    if (!id) throw new FiscalProviderError("UPSTREAM", "Fiscalapi respondió sin identificador de factura; revisa la factura en su panel antes de reintentar.");
    return { providerInvoiceId: id, fiscalUuid: j?.data?.uuid ?? resp?.invoiceUuid ?? null, xml: resp?.invoiceBase64 ? Buffer.from(resp.invoiceBase64, "base64") : null };
  }
  async listCfdi(): Promise<never> { return this.unsupported("Recuperación de CFDI"); }
  async getCfdiStatus(): Promise<never> { return this.unsupported("Consulta de vigencia"); }
}

let instance: FiscalProvider | null = null;
export function getFiscalProvider(): FiscalProvider { return (instance ??= new FiscalapiProvider()); }
