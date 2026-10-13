// Prueba de integración de la conciliación bancaria (cuentas, importación, sugerencias, conciliar, crear gasto, ignorar, aislamiento y permisos).
// Escribe datos de prueba en Meridian Yachts y los retira al terminar. Exige PROCURA_TEST_CONFIRM=yes.
import { Client, db, orgId } from "./client.mjs";

if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes para escribir datos de prueba en la base de .env.local."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts"), golfo = await orgId("Refacciones Marinas del Golfo");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const ricardo = await new Client("ricardo").loginMagic("ventas@refaccionesdelgolfo-demo.example.com"); await ricardo.useOrg(golfo);
const tag = `B${Date.now()}`; let acct, exp1, exp2;
try {
  let r = await axel.call("/bank/accounts", "POST", { name: `Prueba ${tag}`, bank: "BancoX", last4: "1234" }); check("crea cuenta", r.status === 201); acct = r.body.id;
  check("rechaza número completo", (await axel.call("/bank/accounts", "POST", { name: "x", last4: "12345678" })).status === 422);
  check("solicitante no ve cuentas", (await luis.call("/bank/accounts")).status === 403);
  check("solicitante no crea cuentas", (await luis.call("/bank/accounts", "POST", { name: "x" })).status === 403);
  check("otra organización no ve la cuenta", !((await ricardo.call("/bank/accounts")).body?.data ?? []).some((a) => a.id === acct));

  r = await axel.call("/expenses", "POST", { spent_at: "2026-10-11", description: `Cerveza ${tag}`, amount_minor: 12100, currency: "MXN", supplier_name: "Cadena Comercial Oxxo" }); exp1 = r.body.id;
  r = await axel.call("/expenses", "POST", { spent_at: "2026-10-12", description: `Ya pagado ${tag}`, amount_minor: 7700, currency: "MXN", supplier_name: "Vercel", paid: { method: "CARD" } }); exp2 = r.body.id;

  const csv = `Banco X;Cuenta 1234\nFecha;Descripción;Cargo;Abono;Saldo\n12/10/2026;COMPRA OXXO CABO ${tag};121.00;;5,000.00\n12/10/2026;VERCEL INC ${tag};77.00;;4,923.00\n13/10/2026;CARGO SIN TICKET ${tag};350.00;;4,573.00\n13/10/2026;INTERES ${tag};;1.50;4,574.50\n`;
  r = await axel.call(`/bank/accounts/${acct}/import`, "POST", { csv, dry_run: true }); check("vista previa: 4 nuevos", r.status === 200 && r.body.new === 4, JSON.stringify(r.body));
  check("la vista previa no escribe", ((await axel.call(`/bank/transactions?account_id=${acct}`)).body.data).length === 0);
  r = await axel.call(`/bank/accounts/${acct}/import`, "POST", { csv }); check("importa 4", r.status === 200 && r.body.new === 4);
  r = await axel.call(`/bank/accounts/${acct}/import`, "POST", { csv }); check("reimportar no duplica", r.body.new === 0 && r.body.duplicates === 4);
  check("CSV inválido da 400", (await axel.call(`/bank/accounts/${acct}/import`, "POST", { csv: "esto no es un estado de cuenta ni nada" })).status === 400);

  r = await axel.call(`/bank/transactions?account_id=${acct}`); const rows = r.body.data;
  const oxxo = rows.find((t) => t.description.startsWith("COMPRA OXXO")), vercel = rows.find((t) => t.description.startsWith("VERCEL")), sinTicket = rows.find((t) => t.description.startsWith("CARGO SIN")), interes = rows.find((t) => t.description.startsWith("INTERES"));
  check("cargo negativo y abono positivo", oxxo.amount_minor === -12100 && interes.amount_minor === 150);
  check("sugiere el gasto pendiente de Oxxo", oxxo.suggestions[0]?.kind === "expense" && oxxo.suggestions[0].id === exp1, JSON.stringify(oxxo.suggestions));
  check("sugiere el pago ya registrado de Vercel", vercel.suggestions[0]?.kind === "payment", JSON.stringify(vercel.suggestions));
  check("sin coincidencias para el cargo sin ticket", sinTicket.suggestions.length === 0);

  check("solicitante no concilia", (await luis.call(`/bank/transactions/${oxxo.id}/reconcile`, "POST", { expense_id: exp1 })).status === 403);
  check("no concilia un cargo con una venta", (await axel.call(`/bank/transactions/${oxxo.id}/reconcile`, "POST", { sale_id: exp1 })).status === 400);
  r = await axel.call(`/bank/transactions/${oxxo.id}/reconcile`, "POST", { expense_id: exp1 }); check("concilia con el gasto (registra el pago)", r.status === 200);
  r = await axel.call(`/expenses/${exp1}`); check("el gasto queda pagado con la fecha del banco", r.body.payment_status === "COLLECTED" && r.body.payments[0].paid_at.startsWith("2026-10-12"), JSON.stringify(r.body.payments));
  check("no se concilia dos veces", (await axel.call(`/bank/transactions/${oxxo.id}/reconcile`, "POST", { expense_id: exp1 })).status === 409);
  r = await axel.call(`/bank/transactions/${vercel.id}/reconcile`, "POST", { payment_id: vercel.suggestions[0].payment_id }); check("concilia con un pago existente", r.status === 200);
  r = await axel.call(`/expenses/${exp2}`); check("no se duplicó el pago", r.body.payments.filter((p) => !p.voided_at).length === 1);
  r = await axel.call(`/bank/transactions/${sinTicket.id}/expense`, "POST", { description: `Gasto del banco ${tag}` }); check("crea gasto desde el cargo", r.status === 201);
  const nuevo = (await axel.call(`/expenses/${r.body.expense_id}`)).body; check("el gasto nuevo queda pagado y por el importe", nuevo.payment_status === "COLLECTED" && Number(nuevo.amount_minor) === 35000);
  check("un abono no se vuelve gasto", (await axel.call(`/bank/transactions/${interes.id}/expense`, "POST", { description: "x" })).status === 400);
  check("ignora el abono", (await axel.call(`/bank/transactions/${interes.id}/ignore`, "POST", { ignored: true })).status === 200);
  check("no se puede ignorar uno conciliado", (await axel.call(`/bank/transactions/${oxxo.id}/ignore`, "POST", { ignored: true })).status === 409);
  r = await axel.call(`/bank/accounts`); const a = r.body.data.find((x) => x.id === acct); check("contadores de la cuenta", a.matched === 3 && a.unmatched === 0, JSON.stringify(a));
  check("deshacer conciliación", (await axel.call(`/bank/transactions/${oxxo.id}/unmatch`, "POST", {})).status === 200 && ((await axel.call(`/bank/transactions?account_id=${acct}`)).body.data).some((t) => t.id === oxxo.id));
  check("otra organización no ve movimientos", ((await ricardo.call(`/bank/transactions?account_id=${acct}`)).body?.data ?? []).length === 0);
} finally {
  const c = await db();
  try {
    await c.query("delete from bank_transactions where organization_id=$1 and bank_account_id in (select id from bank_accounts where name like $2)", [meridian, `Prueba ${tag}%`]);
    await c.query("delete from bank_accounts where organization_id=$1 and name like $2", [meridian, `Prueba ${tag}%`]);
    await c.query("delete from payments where organization_id=$1 and expense_id in (select id from expenses where organization_id=$1 and description like $2)", [meridian, `%${tag}%`]);
    await c.query("delete from expenses where organization_id=$1 and description like $2", [meridian, `%${tag}%`]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await c.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
