import { env } from "@/lib/env";
import { FiscalProviderError, type FiscalCapabilities, type FiscalProvider } from "@/lib/fiscal/provider";

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
  readonly capabilities: FiscalCapabilities = { issue: false, fetchIssued: false, fetchReceived: false, statusLookup: false, downloadXml: false, downloadPdf: false };
  get notes() {
    const out = ["Solo la prueba de conexión está implementada y verificada. Emitir, recuperar y descargar CFDI aún no: falta verificar las rutas exactas y la estructura de emisores y certificados."];
    if (!this.isConfigured()) out.push("Faltan las variables de entorno FISCALAPI_API_KEY y FISCALAPI_TENANT en el servidor.");
    out.push("Cada empresa debe autorizar el acceso a su información fiscal; las credenciales de una no permiten consultar las de otra.");
    return out;
  }
  isConfigured() { const e = env(); return !!(e.FISCALAPI_API_KEY && e.FISCALAPI_TENANT); }
  private unsupported(what: string): never {
    throw new FiscalProviderError(this.isConfigured() ? "NOT_SUPPORTED" : "NOT_CONFIGURED", `${what}: ${this.isConfigured() ? "aún no implementado en el adaptador de Fiscalapi" : "el proveedor fiscal no está configurado"}.`);
  }
  private baseUrl() { return (env().FISCALAPI_URL ?? "https://test.fiscalapi.com").replace(/\/+$/, ""); }
  /** Lista una página mínima de facturas: llamada de solo lectura, verificada, que valida URL, API key y tenant. */
  async testConnection() {
    if (!this.isConfigured()) throw new FiscalProviderError("NOT_CONFIGURED", "Faltan FISCALAPI_API_KEY y FISCALAPI_TENANT en el servidor.");
    const e = env(); const base = this.baseUrl();
    let res: Response;
    try {
      res = await fetch(`${base}/api/v4/invoices?pageNumber=1&pageSize=1`, { method: "GET", headers: { "X-API-KEY": e.FISCALAPI_API_KEY!, "X-TENANT-KEY": e.FISCALAPI_TENANT!, "X-TIME-ZONE": "America/Mazatlan" }, signal: AbortSignal.timeout(10_000) });
    } catch { throw new FiscalProviderError("UPSTREAM", "No se pudo contactar a Fiscalapi (red o tiempo de espera)."); }
    if (res.status === 401 || res.status === 403) throw new FiscalProviderError("UNAUTHORIZED", "Fiscalapi rechazó las credenciales (API key o tenant).");
    if (res.status === 429) throw new FiscalProviderError("RATE_LIMITED", "Fiscalapi limitó las peticiones; reintenta en unos segundos.", Number(res.headers.get("retry-after")) || undefined);
    if (!res.ok) throw new FiscalProviderError("UPSTREAM", `Fiscalapi respondió ${res.status}.`);
    return { ok: true as const, environment: base === "https://test.fiscalapi.com" ? "test" as const : base === "https://live.fiscalapi.com" ? "live" as const : "custom" as const };
  }
  async issueCfdi(): Promise<never> { return this.unsupported("Emisión de CFDI"); }
  async listCfdi(): Promise<never> { return this.unsupported("Recuperación de CFDI"); }
  async getCfdiStatus(): Promise<never> { return this.unsupported("Consulta de vigencia"); }
}

let instance: FiscalProvider | null = null;
export function getFiscalProvider(): FiscalProvider { return (instance ??= new FiscalapiProvider()); }
