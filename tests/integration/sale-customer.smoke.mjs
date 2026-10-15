// Cambiar o quitar el cliente de una venta. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts"); const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const tag = `CC${Date.now().toString().slice(-6)}`; const H = () => ({ "idempotency-key": randomUUID() });
let saleId, a, b;
try {
  a = (await axel.call("/customers", "POST", { name: `Cliente A ${tag}` }, H())).body; b = (await axel.call("/customers", "POST", { name: `Cliente B ${tag}` }, H())).body;
  saleId = (await axel.call("/sales", "POST", { sold_at: "2026-10-15", description: `Venta ${tag}`, customer_id: a.id, lines: [{ description: "x", quantity: 1, unit_price_minor: 1000 }] }, H())).body.id;
  let r = await axel.call(`/sales/${saleId}`, "PATCH", { customer_id: b.id }); check("cambia el cliente", r.status === 200 && r.body.customer?.id === b.id, JSON.stringify(r.body));
  r = await axel.call(`/sales/${saleId}`, "PATCH", { customer_id: null }); check("quita el cliente", r.status === 200 && !r.body.customer, JSON.stringify(r.body));
  r = await axel.call(`/sales/${saleId}`, "PATCH", { customer_id: randomUUID() }); check("cliente inexistente: 400", r.status === 400);
  check("sin permiso: 403", (await luis.call(`/sales/${saleId}`, "PATCH", { customer_id: a.id })).status === 403);
  const d = await db(); await d.query("insert into cfdi_links (organization_id, cfdi_id, sale_id, amount_minor) select $1, id, $2, 1 from cfdi_documents where organization_id=$1 limit 1", [meridian, saleId]);
  const n = (await d.query("select count(*)::int n from cfdi_links where sale_id=$1", [saleId])).rows[0].n; await d.end();
  if (n) { r = await axel.call(`/sales/${saleId}`, "PATCH", { customer_id: a.id }); check("con factura ligada no se cambia (409)", r.status === 409, JSON.stringify(r.body)); } else console.log("  (sin CFDI en Meridian para probar el bloqueo)");
} finally {
  const d = await db(); try { await d.query("delete from cfdi_links where sale_id=$1", [saleId]); await d.query("delete from sale_lines where sale_id=$1", [saleId]); await d.query("delete from sales where id=$1", [saleId]); await d.query("delete from customers where id = any($1)", [[a?.id, b?.id].filter(Boolean)]); } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
