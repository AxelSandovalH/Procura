import { Client, orgId, db, env } from "./client.mjs";
import { createClient } from "@supabase/supabase-js";
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const iss = (await axel.call("/fiscal/issuers")).body.data[0];
let r = await axel.call("/fiscal/connection", "PUT", { issuer_id: iss.id, expedition_zip_code: iss.zipCode, series: "TEST", default_product_code: "84111506", default_unit_code: "E48" });
console.log("configurar emisor:", r.status, r.body?.detail ?? "ok");
const sale = (await axel.call("/sales", "POST", { sold_at: new Date().toISOString().slice(0, 10), description: "Prueba de timbrado (sandbox) — borrar", payment_method: "TRANSFER", lines: [{ description: "Servicio de prueba", quantity: 1, unit_price_minor: 10000, tax_rate: 0.16 }] })).body;
r = await axel.call(`/sales/${sale.id}/invoice`, "POST", { payment_form_code: "03", payment_method_code: "PUE", recipient: { tax_id: "EKU9003173C9", legal_name: "ESCUELA KEMPER URGATE", tax_regime_code: "601", zip_code: "42501", cfdi_use_code: "G03" } });
console.log("emitir:", r.status, JSON.stringify(r.body).slice(0, 900));
const s2 = (await axel.call(`/sales/${sale.id}`)).body;
console.log("venta:", s2.invoicing_status, "documentado", s2.documented_minor, "cfdi:", JSON.stringify(s2.cfdi?.map((c) => ({ uuid: c.cfdi.fiscal_uuid, total: c.cfdi.total_minor, sat: c.cfdi.sat_status }))), "issue:", JSON.stringify(s2.fiscal_issue));
if (process.argv[2] !== "keep") {
  const c = await db(); await c.query("begin"); await c.query("set local session_replication_role = replica");
  const docs = (await c.query("select id, xml_storage_key from cfdi_documents where id in (select cfdi_id from cfdi_links where sale_id=$1)", [sale.id])).rows;
  await c.query("delete from fiscal_issue_requests where sale_id=$1", [sale.id]); await c.query("delete from cfdi_links where sale_id=$1", [sale.id]); await c.query("delete from sale_lines where sale_id=$1", [sale.id]); await c.query("delete from sales where id=$1", [sale.id]);
  await c.query("delete from cfdi_documents where id = any($1)", [docs.map((d) => d.id)]); await c.query("delete from fiscal_provider_connections where organization_id=$1", [meridian]);
  await c.query("delete from audit_logs where resource_id = any($1)", [[sale.id, meridian, ...docs.map((d) => d.id)]]); await c.query("commit"); await c.end();
  const keys = docs.map((d) => d.xml_storage_key).filter(Boolean);
  if (keys.length) await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from("attachments").remove(keys);
  console.log("datos locales de prueba retirados");
}
