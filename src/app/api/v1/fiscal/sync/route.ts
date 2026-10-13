import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

/** Sincronización de CFDI con el proveedor fiscal. Responde con la verdad: no finge una sincronización que no ocurre. */
export const POST = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const p = getFiscalProvider();
  if (!p.capabilities.fetchIssued && !p.capabilities.fetchReceived) {
    throw new Problem(501, "No disponible", p.isConfigured() ? "La sincronización con el proveedor fiscal aún no está implementada." : "El proveedor fiscal no está configurado en el servidor.", { code: p.isConfigured() ? "NOT_SUPPORTED" : "NOT_CONFIGURED" });
  }
  throw Problem.conflict("Sincronización no implementada");
});
