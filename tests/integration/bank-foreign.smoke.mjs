// Conciliar un cargo en pesos con un gasto en dólares (importe distinto: lo fija el tipo de cambio del banco). Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts"); const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const tag = `FX${Date.now().toString().slice(-6)}`; const H = () => ({ "idempotency-key": randomUUID() }); let acct, exp, exp2;
try {
  acct = (await axel.call("/bank/accounts", "POST", { name: `Cuenta ${tag}`, last4: "1234" }, H())).body;
  exp = (await axel.call("/expenses", "POST", { spent_at: "2026-10-10", description: `Vercel ${tag}`, amount_minor: 2000, currency: "USD", supplier_name: "Vercel" }, H())).body;
  exp2 = (await axel.call("/expenses", "POST", { spent_at: "2026-10-10", description: `Supabase ${tag}`, amount_minor: 11686, currency: "USD", supplier_name: "Supabase", paid: { method: "CARD" } }, H())).body;
  const imp = await axel.call(`/bank/accounts/${acct.id}/import`, "POST", { csv: `Fecha,Descripción,Cargos,Abonos\n2026-10-12,COMPRA VERCEL ${tag} SF,412.50,\n2026-10-12,COMPRA OXXO,99.00,\n2026-10-12,SUPABASE ${tag} USD 116.86,2162.89,\n`, dry_run: false }); check("importa los cargos", imp.status === 200 && imp.body.new === 3, JSON.stringify(imp.body));
  const list = (await axel.call(`/bank/transactions?account_id=${acct.id}&status=UNMATCHED`)).body.data; const t = list.find((x) => /VERCEL/.test(x.description)), other = list.find((x) => /OXXO/.test(x.description));
  const s = t.suggestions.find((x) => x.id === exp.id); check("el gasto en USD se ofrece aunque el importe no coincida", !!s && s.fx?.currency === "USD" && s.fx.rate === 20.625, JSON.stringify(t.suggestions));
  check("un cargo sin relación (OXXO, 99 MXN → 4.95 por USD) no lo recibe", !other.suggestions.some((x) => x.id === exp.id), JSON.stringify(other.suggestions));
  const r = await axel.call(`/bank/transactions/${t.id}/reconcile`, "POST", { expense_id: exp.id }); check("concilia", r.status === 200, JSON.stringify(r.body));
  const e = (await axel.call(`/expenses/${exp.id}`)).body; check("el gasto queda pagado en dólares", e.payments?.length === 1 && e.payments[0].currency === "USD" && Number(e.payments[0].amount_minor) === 2000 && /412\.50 MXN/.test(e.payments[0].notes ?? ""), JSON.stringify(e.payments));
  const t2 = list.find((x) => /SUPABASE/.test(x.description)); const s2 = t2.suggestions.find((x) => x.kind === "payment" && x.fx);
  check("un gasto en USD ya pagado se ofrece como pago registrado", !!s2 && s2.fx.currency === "USD" && s2.fx.rate === 18.5084, JSON.stringify(t2.suggestions));
  const r2 = await axel.call(`/bank/transactions/${t2.id}/reconcile`, "POST", { payment_id: s2.payment_id }); check("concilia el pago en USD contra el cargo en pesos", r2.status === 200, JSON.stringify(r2.body));
  const e2 = (await axel.call(`/expenses/${exp2.id}`)).body; check("el pago conserva su moneda y anota el cargo", e2.payments.length === 1 && e2.payments[0].currency === "USD" && /2162\.89 MXN/.test(e2.payments[0].notes ?? ""), JSON.stringify(e2.payments));
  const m = (await axel.call(`/bank/transactions?account_id=${acct.id}&status=MATCHED`)).body.data; check("el movimiento queda conciliado", m.some((x) => x.id === t.id));
} finally {
  const d = await db(); try {
    await d.query("update bank_transactions set payment_id=null where bank_account_id=$1", [acct?.id]); await d.query("delete from payments where expense_id = any($1)", [[exp?.id, exp2?.id].filter(Boolean)]);
    await d.query("delete from bank_transactions where bank_account_id=$1", [acct?.id]); await d.query("delete from bank_accounts where id=$1", [acct?.id]); await d.query("delete from expenses where id = any($1)", [[exp?.id, exp2?.id].filter(Boolean)]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
