// Aviso de pocos créditos de timbrado: notifica una sola vez al cruzar 10 y otra al llegar a 0, a quienes administran. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { execFileSync } from "node:child_process";
import { Client, db, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const clean = async () => { const d = await db(); await d.query("delete from notifications where organization_id=$1 and type like 'billing.credits_%'", [meridian]); await d.query("delete from stamp_credit_ledger where organization_id=$1", [meridian]); await d.query("delete from organization_subscriptions where organization_id=$1", [meridian]); await d.end(); };
try {
  await clean(); const d = await db(); await d.query("insert into organization_subscriptions (organization_id, credits_required) values ($1, true)", [meridian]); await d.end();
  const out = execFileSync("npx", ["tsx", "--env-file=.env.local", "tests/integration/credit-alert.ts", meridian], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" }).trim().split("\n").pop();
  const r = JSON.parse(out);
  check("con 11 créditos no hay aviso", r.con11.low === 0 && r.con11.empty === 0, out);
  check("al llegar a 10: un aviso de «pocos créditos»", r.con10.low >= 1 && r.con10.empty === 0, out);
  check("con 9 no se repite el aviso", r.con9.low === r.con10.low, out);
  check("con 1 sigue sin aviso de «sin créditos»", r.con1.empty === 0, out);
  check("al llegar a 0: aviso de «sin créditos»", r.con0.empty >= 1, out);
  check("repetir el mismo consumo no avisa ni descuenta otra vez", r.repetido.added === false && r.repetido.empty === r.con0.empty, out);
  const b = await axel.call("/billing"); check("el saldo en la pantalla es 0 y el nivel «EMPTY»", b.body.credits.available === 0 && b.body.credits.level === "EMPTY" && b.body.credits.low_threshold === 10, JSON.stringify(b.body.credits));
  const d2 = await db(); await d2.query("insert into stamp_credit_ledger (organization_id, delta, kind, reference) values ($1, 7, 'ADJUST', 'x7')", [meridian]); await d2.end();
  check("con 7 créditos el nivel es «LOW»", (await axel.call("/billing")).body.credits.level === "LOW");
  const d3 = await db(); await d3.query("insert into stamp_credit_ledger (organization_id, delta, kind, reference) values ($1, 50, 'ADJUST', 'x50')", [meridian]); await d3.end();
  check("con 57 créditos el nivel es «OK»", (await axel.call("/billing")).body.credits.level === "OK");
} finally { await clean(); }
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
