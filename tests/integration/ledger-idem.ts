// Comprueba que un movimiento del libro de créditos con la misma referencia no se duplica. Uso: tsx --env-file=.env.local tests/integration/ledger-idem.ts <organizationId> <referencia>
import { withContext } from "@/lib/db/client";
import { addLedger, creditBalance } from "@/lib/billing/credits";
async function main() {
  const [org, ref] = process.argv.slice(2);
  const r = await withContext({ organizationId: org! }, async (tx) => {
    const a = await addLedger(tx, org!, -1, "CONSUME", ref!, "prueba"), b = await addLedger(tx, org!, -1, "CONSUME", ref!, "prueba (repetido)");
    return { primera: a, repetida: b, saldo: await creditBalance(tx, org!) };
  });
  console.log(JSON.stringify(r)); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
