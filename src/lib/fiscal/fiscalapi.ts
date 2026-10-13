import { env } from "@/lib/env";
import { FiscalProviderError, type CancelRequest, type CancelResult, type DownloadRequest, type DownloadRule, type DownloadedXml, type FiscalCapabilities, type FiscalProvider, type IssueRequest, type IssuedCfdi, type ProviderIssuer } from "@/lib/fiscal/provider";

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
  readonly capabilities: FiscalCapabilities = { issue: true, fetchIssued: true, fetchReceived: true, statusLookup: true, downloadXml: false, downloadPdf: true, cancel: true };
  get notes() {
    const out = ["Implementado: prueba de conexión, listado de emisores, emisión de factura de ingreso y descarga masiva de CFDI del SAT (reglas, solicitudes e importación). Cancelación y consulta de estado (verificadas contra su documentación; la cancelación solo aplica a facturas emitidas por referencia). PDF de las facturas emitidas (POST /api/v4/invoices/pdf)."];
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
  private async request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, timeZone = "America/Mazatlan"): Promise<{ status: number; json: unknown }> {
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
  // ---- Descarga masiva (docs.fiscalapi.com: /download-rules y /download-requests). Los campos de estado se leen con tolerancia: la documentación
  // no detalla todos los valores, y se muestran tal cual al usuario. Los periodos de una solicitud no pueden exceder 31 días (CFDI).
  /** Texto del error del proveedor: errores por campo (data[]) o el detalle; sin credenciales. */
  private why(j: unknown): string {
    const o = j as { data?: unknown; details?: unknown; message?: unknown } | null;
    if (Array.isArray(o?.data)) return (o!.data as { propertyName?: string; errorMessage?: string }[]).map((e) => `${e.propertyName ?? "campo"}: ${e.errorMessage ?? ""}`).join("; ");
    return (typeof o?.details === "string" && o.details) || (typeof o?.message === "string" && o.message) || "sin detalle";
  }
  private rule(r: Record<string, unknown>): DownloadRule {
    const nested = (k: string) => (r[k] && typeof r[k] === "object" ? String((r[k] as Record<string, unknown>).id ?? (r[k] as Record<string, unknown>).description ?? "") || null : null);
    const flat = (k: string) => (r[k] != null && typeof r[k] !== "object" ? String(r[k]) : null);
    return { id: String(r.id), personId: flat("personId") ?? nested("person"), tin: flat("tin"), description: String(r.description ?? ""),
      queryType: flat("satQueryTypeId") ?? nested("satQueryType"), downloadType: flat("downloadTypeId") ?? nested("downloadType"), invoiceStatus: flat("satInvoiceStatusId") ?? nested("satInvoiceStatus"),
      status: flat("downloadRuleStatusId") ?? nested("downloadRuleStatus") };
  }
  private req(r: Record<string, unknown>): DownloadRequest {
    const flat = (k: string) => (r[k] != null && typeof r[k] !== "object" ? String(r[k]) : null);
    const desc = (k: string) => { const o = r[k]; return o && typeof o === "object" ? String((o as Record<string, unknown>).description ?? (o as Record<string, unknown>).id ?? "") || null : null; };
    return { id: String(r.id), ruleId: flat("downloadRuleId"), ready: r.isReadyToDownload === true, invoiceCount: typeof r.invoiceCount === "number" ? r.invoiceCount : null,
      status: desc("downloadRequestStatus") ?? flat("downloadRequestStatusId") ?? desc("satRequestStatus") ?? flat("satRequestStatusId"), startDate: flat("startDate"), endDate: flat("endDate") };
  }
  private async page(path: string): Promise<{ items: Record<string, unknown>[]; hasNext: boolean }> {
    const r = await this.request("GET", path);
    if (r.status === 425) return { items: [], hasNext: false };
    if (r.status < 200 || r.status >= 300) throw new FiscalProviderError("UPSTREAM", `Fiscalapi respondió ${r.status} en ${path.split("?")[0]}.`);
    const d = (r.json as { data?: { items?: Record<string, unknown>[]; hasNextPage?: boolean } } | null)?.data;
    return { items: d?.items ?? [], hasNext: d?.hasNextPage === true };
  }
  async listDownloadRules(): Promise<DownloadRule[]> {
    const out: DownloadRule[] = [];
    for (let n = 1; n <= 10; n++) { const p = await this.page(`/api/v4/download-rules?pageNumber=${n}&pageSize=50`); out.push(...p.items.map((i) => this.rule(i))); if (!p.hasNext) break; }
    return out;
  }
  async createDownloadRule(input: { personId: string; description: string; downloadType: "Emitidos" | "Recibidos" }): Promise<DownloadRule> {
    const r = await this.request("POST", "/api/v4/download-rules", { personId: input.personId, description: input.description.slice(0, 100), satQueryTypeId: "CFDI", downloadTypeId: input.downloadType, satInvoiceStatusId: "Vigente" });
    const j = r.json as { succeeded?: boolean; details?: unknown; data?: Record<string, unknown> } | null;
    if (r.status < 200 || r.status >= 300 || j?.succeeded === false || !j?.data?.id) throw new FiscalProviderError("UPSTREAM", `Fiscalapi no pudo crear la regla de descarga (${r.status}): ${this.why(r.json)}`.slice(0, 600));
    return this.rule(j.data);
  }
  async listDownloadRequests(maxPages = 6): Promise<DownloadRequest[]> {
    const out: DownloadRequest[] = [];
    for (let n = 1; n <= maxPages; n++) { const p = await this.page(`/api/v4/download-requests?pageNumber=${n}&pageSize=50`); out.push(...p.items.map((i) => this.req(i))); if (!p.hasNext) break; }
    return out;
  }
  async createDownloadRequest(input: { ruleId: string; start: Date; end: Date }): Promise<DownloadRequest> {
    const r = await this.request("POST", "/api/v4/download-requests", { downloadRuleId: input.ruleId, downloadRequestTypeId: "Manual", startDate: input.start.toISOString(), endDate: input.end.toISOString() });
    const j = r.json as { succeeded?: boolean; details?: unknown; data?: Record<string, unknown> } | null;
    if (r.status < 200 || r.status >= 300 || j?.succeeded === false || !j?.data?.id) throw new FiscalProviderError("UPSTREAM", `Fiscalapi no pudo crear la solicitud de descarga (${r.status}): ${this.why(r.json)}`.slice(0, 600));
    return this.req(j.data);
  }
  /** GET /api/v4/download-requests/{id}/xmls: cada elemento trae el CFDI completo en base64 (base64Content). */
  async listDownloadedXml(requestId: string, page: number): Promise<{ items: DownloadedXml[]; hasNext: boolean }> {
    const p = await this.page(`/api/v4/download-requests/${encodeURIComponent(requestId)}/xmls?pageNumber=${page}&pageSize=50`);
    return { hasNext: p.hasNext, items: p.items.filter((i) => typeof i.base64Content === "string" && i.base64Content).map((i) => ({ id: String(i.id), xml: Buffer.from(String(i.base64Content), "base64") })) };
  }
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
  async getCfdiStatus(): Promise<never> { return this.unsupported("Consulta de vigencia por folio fiscal"); }
  /** DELETE /api/v4/invoices {id, cancellationReasonCode: 01|02|03, replacementUuid (con 01)}. Firma con el CSD del emisor ya cargado; el motivo 04 (factura global) no se admite por esta vía. */
  async cancelCfdi(req: CancelRequest): Promise<CancelResult> {
    const r = await this.request("DELETE", "/api/v4/invoices", { id: req.providerInvoiceId, cancellationReasonCode: req.reasonCode, ...(req.reasonCode === "01" ? { replacementUuid: req.replacementUuid } : {}) });
    const j = r.json as { succeeded?: boolean; data?: { base64CancellationAcknowledgement?: string; invoiceUuids?: Record<string, string> } } | null;
    if (r.status < 200 || r.status >= 300 || j?.succeeded === false) {
      if (r.status === 404) throw new FiscalProviderError("UPSTREAM", "Fiscalapi no encontró esta factura (¿se emitió con otra cuenta o ambiente?).");
      throw new FiscalProviderError("UPSTREAM", `Fiscalapi no pudo cancelar el CFDI (${r.status}): ${this.why(r.json)}`.slice(0, 600));
    }
    const codes = Object.values(j?.data?.invoiceUuids ?? {});
    return { satCode: codes[0] ?? null, acknowledgement: j?.data?.base64CancellationAcknowledgement ?? null };
  }
  /** POST /api/v4/invoices/pdf {invoiceId} → data.base64File. */
  async invoicePdf(providerInvoiceId: string): Promise<Buffer> {
    const r = await this.request("POST", "/api/v4/invoices/pdf", { invoiceId: providerInvoiceId });
    const j = r.json as { succeeded?: boolean; data?: { base64File?: string } } | null;
    if (r.status < 200 || r.status >= 300 || j?.succeeded === false || !j?.data?.base64File) throw new FiscalProviderError("UPSTREAM", `Fiscalapi no pudo generar el PDF (${r.status}): ${this.why(r.json)}`.slice(0, 400));
    const pdf = Buffer.from(j.data.base64File, "base64");
    if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new FiscalProviderError("UPSTREAM", "Fiscalapi respondió algo que no es un PDF.");
    return pdf;
  }
  /** POST /api/v4/invoices/status {id} → data.status («Vigente», «Cancelando», «Cancelado»), data.cancelableStatus. */
  async invoiceStatus(providerInvoiceId: string) {
    const r = await this.request("POST", "/api/v4/invoices/status", { id: providerInvoiceId });
    const j = r.json as { succeeded?: boolean; data?: { status?: string; cancelableStatus?: string } } | null;
    if (r.status < 200 || r.status >= 300 || j?.succeeded === false) throw new FiscalProviderError("UPSTREAM", `Fiscalapi no pudo consultar el estado (${r.status}): ${this.why(r.json)}`.slice(0, 400));
    const raw = String(j?.data?.status ?? "").trim(); const s = raw.toLowerCase();
    const state = s.startsWith("cancelando") ? "CANCELANDO" as const : s.startsWith("cancelado") ? "CANCELADO" as const : s.startsWith("vigente") ? "VIGENTE" as const : "UNKNOWN" as const;
    return { state, raw, cancelable: j?.data?.cancelableStatus?.trim() || null };
  }
}

let instance: FiscalProvider | null = null;
export function getFiscalProvider(): FiscalProvider { return (instance ??= new FiscalapiProvider()); }
