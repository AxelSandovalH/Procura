// Prueba del aviso de pocos créditos: consume créditos y cuenta las notificaciones creadas al cruzar el umbral. Uso: tsx --env-file=.env.local tests/integration/credit-alert.ts <organizationId>
import { withContext } from "@/lib/db/client";
import { addLedger, consumeCredit } from "@/lib/billing/credits";
async function main() {
  const org = process.argv[2]!;
  const tx1 = <T,>(fn: (tx: Parameters<Parameters<typeof withContext>[1]>[0]) => Promise<T>) => withContext({ organizationId: org }, fn);
  const count = (type: string) => tx1((tx) => tx.notifications.count({ where: { organization_id: org, type } }));
  const both = async () => ({ low: await count("billing.credits_low"), empty: await count("billing.credits_empty") });
  const consume = (ref: string) => tx1((tx) => consumeCredit(tx, org, ref, "t"));
  await tx1((tx) => addLedger(tx, org, 12, "ADJUST", "prueba-alerta-12", "prueba"));
  const r: Record<string, unknown> = {};
  await consume("a1"); r.con11 = await both();   // 12 → 11: sin aviso
  await consume("a2"); r.con10 = await both();   // 11 → 10: aviso «pocos»
  await consume("a3"); r.con9 = await both();    // 10 → 9: no repite
  for (let i = 4; i <= 11; i++) await consume(`a${i}`); // 9 → 1
  r.con1 = await both();
  await consume("a12"); r.con0 = await both();   // 1 → 0: aviso «sin créditos»
  const rep = await consume("a12"); r.repetido = { added: rep.added, empty: (await both()).empty }; // misma referencia: nada
  console.log(JSON.stringify(r)); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
