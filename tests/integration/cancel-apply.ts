// Aplica el estado «CANCELADO» a un CFDI como lo haría la confirmación del SAT (sin llamar al proveedor). Uso: tsx --env-file=.env.local tests/integration/cancel-apply.ts <organizationId> <cfdiId> <estado>
import { withContext } from "@/lib/db/client";
import { applyInvoiceState } from "@/lib/billing/cancel";
const [org, id, state] = process.argv.slice(2);
async function main() {
  const r = await withContext({ organizationId: org! }, (tx) => applyInvoiceState(tx, org!, null, id!, state as "CANCELADO" | "VIGENTE" | "CANCELANDO"));
  console.log(r); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
