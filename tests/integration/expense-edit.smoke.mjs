// Editar el monto de un gasto. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts"); const axel = await new Client("a").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("l").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const H = () => ({ "idempotency-key": randomUUID() }); let id;
try {
  id = (await axel.call("/expenses", "POST", { spent_at: "2026-10-10", description: "Gasto editable", amount_minor: 100000, supplier_name: "Prov" }, H())).body.id;
  let r = await axel.call(`/expenses/${id}`, "PATCH", { amount_minor: 120000, description: "Gasto corregido", category: "Otros" }); check("sube el monto y edita datos", r.status === 200 && Number(r.body.amount_minor) === 120000 && r.body.description === "Gasto corregido", JSON.stringify(r.body));
  await axel.call(`/expenses/${id}/payments`, "POST", { paid_at: "2026-10-11", amount_minor: 50000, method: "CASH" }, H());
  r = await axel.call(`/expenses/${id}/payments`, "GET"); r = await axel.call(`/expenses/${id}`); check("pendiente = monto − pagado", Number(r.body.pending_to_pay_minor) === 70000, JSON.stringify(r.body.pending_to_pay_minor));
  r = await axel.call(`/expenses/${id}`, "PATCH", { amount_minor: 40000 }); check("no baja del monto ya pagado (409)", r.status === 409, JSON.stringify(r.body));
  r = await axel.call(`/expenses/${id}`, "PATCH", { amount_minor: 50000 }); check("puede igualar lo pagado: queda pagado", r.status === 200 && Number(r.body.pending_to_pay_minor) === 0, JSON.stringify([r.body.payment_status, r.body.pending_to_pay_minor]));
  check("sin permiso: 403", (await luis.call(`/expenses/${id}`, "PATCH", { amount_minor: 60000 })).status === 403);
} finally { const d = await db(); try { await d.query("delete from payments where expense_id=$1", [id]); await d.query("delete from expenses where id=$1", [id]); } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); } }
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
