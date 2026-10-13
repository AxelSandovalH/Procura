import { env } from "@/lib/env";
import { FiscalProviderError, type FiscalCapabilities, type FiscalProvider } from "@/lib/fiscal/provider";

/**
 * Adaptador de Fiscalapi — ESTRUCTURA SOLAMENTE.
 *
 * No hay llamadas reales: no se pudo verificar la documentación oficial vigente (encabezados de autenticación, endpoints,
 * estructura de solicitudes), y este proyecto no inventa contratos. Lo que se sabe por su SDK público es que opera con
 * una URL (entornos de pruebas y producción), una clave de API y un identificador de tenant; las variables
 * FISCALAPI_URL / FISCALAPI_API_KEY / FISCALAPI_TENANT reservan ese lugar. Cuando se confirme el contrato, cada método se
 * implementa aquí y se declara la capacidad correspondiente.
 */
class FiscalapiProvider implements FiscalProvider {
  readonly name = "fiscalapi";
  readonly capabilities: FiscalCapabilities = { issue: false, fetchIssued: false, fetchReceived: false, statusLookup: false, downloadXml: false, downloadPdf: false };
  get notes() {
    const out = ["Las llamadas reales a Fiscalapi no están implementadas: falta verificar su documentación oficial y contar con una cuenta."];
    if (!this.isConfigured()) out.push("Faltan las variables de entorno FISCALAPI_API_KEY y FISCALAPI_TENANT en el servidor.");
    out.push("Cada empresa debe autorizar el acceso a su información fiscal; las credenciales de una no permiten consultar las de otra.");
    return out;
  }
  isConfigured() { const e = env(); return !!(e.FISCALAPI_API_KEY && e.FISCALAPI_TENANT); }
  private unsupported(what: string): never {
    throw new FiscalProviderError(this.isConfigured() ? "NOT_SUPPORTED" : "NOT_CONFIGURED", `${what}: ${this.isConfigured() ? "aún no implementado en el adaptador de Fiscalapi" : "el proveedor fiscal no está configurado"}.`);
  }
  async issueCfdi(): Promise<never> { return this.unsupported("Emisión de CFDI"); }
  async listCfdi(): Promise<never> { return this.unsupported("Recuperación de CFDI"); }
  async getCfdiStatus(): Promise<never> { return this.unsupported("Consulta de vigencia"); }
}

let instance: FiscalProvider | null = null;
export function getFiscalProvider(): FiscalProvider { return (instance ??= new FiscalapiProvider()); }
