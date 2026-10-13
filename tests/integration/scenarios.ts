import { contribution, DEFAULT_ASSUMPTIONS, emissionSubscriptionMinor, stampCostMinor } from "@/lib/commercial/economics";
const m = (c: number) => (c / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const cases = [
  { name: "Caso A (favorable)", a: { ...DEFAULT_ASSUMPTIONS, downloadMonthlyMinor: Math.round(9894 / 1.16), emissionSubscriptionPerRfc: false } },
  { name: "Caso B (conservador)", a: { ...DEFAULT_ASSUMPTIONS, downloadMonthlyMinor: Math.round(30000 / 1.16), emissionSubscriptionPerRfc: true } },
];
console.log("timbre sin IVA:", m(stampCostMinor()), "| suscripción de emisión sin IVA:", m(emissionSubscriptionMinor()));
for (const c of cases) {
  console.log(`\n### ${c.name}: descarga masiva ${m(c.a.downloadMonthlyMinor)}/mes por RFC; suscripción de emisión por RFC: ${c.a.emissionSubscriptionPerRfc ? "sí" : "no"}\n`);
  console.log("| Plan | Operación | CFDI | Suscripción | Créditos | Costo timbres | Costo emisión fija | Costo descarga SAT | Comisión de cobro | **Margen** |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const plan of ["esencial", "control", "negocio"]) for (const n of [25, 100, 500]) for (const op of ["recovered", "emitted"] as const) {
    if (op === "recovered" && plan !== "negocio") continue;
    const r = contribution({ plan, recovered: op === "recovered" ? n : 0, emitted: op === "emitted" ? n : 0 }, c.a);
    console.log(`| ${plan} | ${op === "recovered" ? "Recuperados del SAT" : "Emitidos (timbrados)"} | ${n} | ${m(r.subscription)} | ${m(r.credits)} | ${m(r.stampCost)} | ${m(r.emissionFixed)} | ${m(r.recoveryCost)} | ${m(r.fees)} | **${m(r.contribution)}** |`);
  }
}
