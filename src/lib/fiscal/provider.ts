/**
 * Capa de abstracción de proveedores fiscales (PAC / servicios de CFDI). La lógica de negocio solo conoce esta interfaz;
 * ningún tipo ni respuesta de un proveedor concreto sale de su adaptador.
 *
 * Emisión y recuperación automática son flujos DISTINTOS y se declaran por separado en `capabilities`.
 * Un adaptador solo declara una capacidad cuando está implementada Y verificada contra la documentación oficial del proveedor.
 */
export interface FiscalCapabilities {
  issue: boolean;            // emitir CFDI
  fetchIssued: boolean;      // recuperar CFDI emitidos
  fetchReceived: boolean;    // recuperar CFDI recibidos (requiere autorización fiscal de la empresa)
  statusLookup: boolean;     // consultar vigencia ante el SAT
  downloadXml: boolean;
  downloadPdf: boolean;
}

/** Comprobante normalizado, independiente del proveedor. */
export interface NormalizedCfdi {
  fiscalUuid: string; direction: "ISSUED" | "RECEIVED";
  xml?: Buffer; pdfUrl?: string; externalId: string; satStatus: "UNKNOWN" | "VIGENTE" | "CANCELADO";
}

export interface IssueRequest {
  organizationId: string; saleId: string; idempotencyKey: string;
  // Los datos fiscales se definirán cuando se verifique el contrato real del proveedor.
}

export class FiscalProviderError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "NOT_SUPPORTED" | "RATE_LIMITED" | "UNAUTHORIZED" | "UPSTREAM", message: string, public retryAfterSeconds?: number) { super(message); }
}

export interface FiscalProvider {
  readonly name: string;
  isConfigured(): boolean;
  readonly capabilities: FiscalCapabilities;
  /** Por qué no está operativo (para mostrarlo en la configuración). */
  readonly notes: string[];
  issueCfdi(req: IssueRequest): Promise<NormalizedCfdi>;
  listCfdi(orgExternalAccount: string, params: { direction: "ISSUED" | "RECEIVED"; from: Date; to: Date; cursor?: string }): Promise<{ items: NormalizedCfdi[]; nextCursor?: string }>;
  getCfdiStatus(fiscalUuid: string): Promise<NormalizedCfdi["satStatus"]>;
  /** Comprueba que las credenciales del servidor funcionan, sin modificar nada en el proveedor. */
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
