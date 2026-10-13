/**
 * Capa de abstracción de proveedores fiscales (PAC / servicios de CFDI). La lógica de negocio solo conoce esta interfaz;
 * ningún tipo ni respuesta de un proveedor concreto sale de su adaptador.
 *
 * Emisión y recuperación automática son flujos DISTINTOS y se declaran por separado en `capabilities`.
 * Un adaptador solo declara una capacidad cuando está implementada Y verificada contra la documentación oficial del proveedor.
 */
export interface FiscalCapabilities {
  issue: boolean;            // emitir CFDI
  fetchIssued: boolean;      // recuperar CFDI emitidos (descarga masiva)
  fetchReceived: boolean;    // recuperar CFDI recibidos (requiere autorización fiscal de la empresa)
  statusLookup: boolean;     // consultar vigencia ante el SAT
  downloadXml: boolean;
  downloadPdf: boolean;
  cancel: boolean;           // cancelar CFDI emitidos
}

/** Comprobante normalizado, independiente del proveedor. */
export interface NormalizedCfdi {
  fiscalUuid: string; direction: "ISSUED" | "RECEIVED";
  xml?: Buffer; pdfUrl?: string; externalId: string; satStatus: "UNKNOWN" | "VIGENTE" | "CANCELADO";
}

/** Solicitud de emisión normalizada: el adaptador la traduce al contrato de su proveedor. */
export interface IssueRequest {
  issuerId: string;                      // id del emisor ya registrado (con sus certificados) en el proveedor
  series: string; date: string;          // fecha local AAAA-MM-DDThh:mm:ss
  currency: string; expeditionZipCode: string;
  paymentFormCode: string; paymentMethodCode: "PUE" | "PPD";
  recipient: { taxId: string; legalName: string; taxRegimeCode: string; cfdiUseCode: string; zipCode: string; email?: string };
  items: { sku: string; productCode: string; unitCode: string; description: string; quantity: number; unitPrice: number; discount: number; taxRate: number }[];
  timeZone: string;
}
/** Estado de un CFDI emitido según el proveedor/SAT. */
export type InvoiceState = "VIGENTE" | "CANCELANDO" | "CANCELADO" | "UNKNOWN";
export interface CancelRequest { providerInvoiceId: string; reasonCode: "01" | "02" | "03"; replacementUuid?: string }
export interface CancelResult { satCode: string | null; acknowledgement: string | null }
export interface IssuedCfdi { providerInvoiceId: string; fiscalUuid: string | null; xml: Buffer | null }
export interface ProviderIssuer { id: string; legalName: string; taxId: string; taxRegimeCode: string | null; zipCode: string | null }

/** Descarga masiva de CFDI del SAT a través del proveedor (requiere e.firma de la persona cargada en el proveedor). */
export interface DownloadRule { id: string; personId: string | null; tin: string | null; description: string; queryType: string | null; downloadType: string | null; invoiceStatus: string | null; status: string | null }
export interface DownloadRequest { id: string; ruleId: string | null; ready: boolean; invoiceCount: number | null; status: string | null; startDate: string | null; endDate: string | null }
export interface DownloadedXml { id: string; xml: Buffer }

export class FiscalProviderError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "NOT_SUPPORTED" | "RATE_LIMITED" | "UNAUTHORIZED" | "UPSTREAM", message: string, public retryAfterSeconds?: number) { super(message); }
}

export interface FiscalProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Ambiente al que apunta el servidor: «live» emite comprobantes reales ante el SAT. */
  environment(): "test" | "live" | "custom";
  readonly capabilities: FiscalCapabilities;
  /** Por qué no está operativo (para mostrarlo en la configuración). */
  readonly notes: string[];
  issueCfdi(req: IssueRequest): Promise<IssuedCfdi>;
  listIssuers(): Promise<ProviderIssuer[]>;
  listCfdi(orgExternalAccount: string, params: { direction: "ISSUED" | "RECEIVED"; from: Date; to: Date; cursor?: string }): Promise<{ items: NormalizedCfdi[]; nextCursor?: string }>;
  getCfdiStatus(fiscalUuid: string): Promise<NormalizedCfdi["satStatus"]>;
  /** Solicita la cancelación de un CFDI emitido por este proveedor. No es inmediata: el CFDI pasa a «Cancelando» y luego a «Cancelado» (o vuelve a «Vigente»). */
  cancelCfdi(req: CancelRequest): Promise<CancelResult>;
  /** Estado actual de un CFDI emitido (consulta al SAT a través del proveedor). */
  invoiceStatus(providerInvoiceId: string): Promise<{ state: InvoiceState; raw: string; cancelable: string | null }>;
  /** Comprueba que las credenciales del servidor funcionan, sin modificar nada en el proveedor. */
  listDownloadRules(): Promise<DownloadRule[]>;
  createDownloadRule(input: { personId: string; description: string; downloadType: "Emitidos" | "Recibidos" }): Promise<DownloadRule>;
  listDownloadRequests(maxPages?: number): Promise<DownloadRequest[]>;
  createDownloadRequest(input: { ruleId: string; start: Date; end: Date }): Promise<DownloadRequest>;
  listDownloadedXml(requestId: string, page: number): Promise<{ items: DownloadedXml[]; hasNext: boolean }>;
  testConnection(): Promise<{ ok: true; environment: "test" | "live" | "custom" }>;
}

/** Reintento con espera exponencial solo para errores transitorios (límite de API / fallo del proveedor). */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3, base = opts.baseMs ?? 500;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      const transient = e instanceof FiscalProviderError && (e.code === "RATE_LIMITED" || e.code === "UPSTREAM");
      if (!transient || i >= attempts) throw e;
      const wait = e instanceof FiscalProviderError && e.retryAfterSeconds ? e.retryAfterSeconds * 1000 : base * 2 ** (i - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
