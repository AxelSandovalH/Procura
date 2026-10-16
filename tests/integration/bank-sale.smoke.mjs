// Crear una venta desde un abono del banco. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts"); const axel = await new Client("a").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("l").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const tag = `BS${Date.now().toString().slice(-6)}`; const H = () => ({ "idempotency-key": randomUUID() }); let acct, saleId;
try {
  acct = (await axel.call("/bank/accounts", "POST", { name: `Cuenta ${tag}`, last4: "4321" }, H())).body;
  const imp = await axel.call(`/bank/accounts/${acct.id}/import`, "POST", { csv: `Fecha,Descripción,Cargos,Abonos\n2026-10-12,SPEI RECIBIDO STRIPE ${tag},,12.20\n2026-10-12,COMPRA X ${tag},50.00,\n`, dry_run: false }); check("importa", imp.status === 200 && imp.body.new === 2, JSON.stringify(imp.body));
  const list = (await axel.call(`/bank/transactions?account_id=${acct.id}&status=UNMATCHED`)).body.data; const dep = list.find((x) => x.amount_minor > 0), chg = list.find((x) => x.amount_minor < 0);
  check("un cargo no puede convertirse en venta (400)", (await axel.call(`/bank/transactions/${chg.id}/sale`, "POST", { description: "x" }, H())).status === 400);
  check("sin permiso: 403", (await luis.call(`/bank/transactions/${dep.id}/sale`, "POST", { description: "x" }, H())).status === 403);
  const r = await axel.call(`/bank/transactions/${dep.id}/sale`, "POST", { description: `Pago Stripe ${tag}`, tax_percent: 0 }, H()); saleId = r.body?.sale_id; check("crea la venta", r.status === 201 && !!saleId, JSON.stringify(r.body));
  const s = (await axel.call(`/sales/${saleId}`)).body; check("por $12.20, sin IVA, cobrada con la fecha del banco", Number(s.total_minor) === 1220 && Number(s.tax_minor) === 0 && s.collection_status === "COLLECTED" && s.payments.length === 1 && String(s.payments[0].paid_at).startsWith("2026-10-12"), JSON.stringify([s.total_minor, s.tax_minor, s.collection_status, s.payments]));
  const m = (await axel.call(`/bank/transactions?account_id=${acct.id}&status=MATCHED`)).body.data; check("el abono queda conciliado", m.some((x) => x.id === dep.id));
  check("no se puede crear otra venta del mismo abono (409)", (await axel.call(`/bank/transactions/${dep.id}/sale`, "POST", { description: "otra" }, H())).status === 409);
} finally {
  const d = await db(); try {
    await d.query("update bank_transactions set payment_id=null where bank_account_id=$1", [acct?.id]); await d.query("delete from payments where sale_id=$1", [saleId]); await d.query("delete from sale_lines where sale_id=$1", [saleId]); await d.query("delete from sales where id=$1", [saleId]);
    await d.query("delete from bank_transactions where bank_account_id=$1", [acct?.id]); await d.query("delete from bank_accounts where id=$1", [acct?.id]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
