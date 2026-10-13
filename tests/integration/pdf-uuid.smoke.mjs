// El gasto que subió la factura en PDF (folio fiscal) se liga solo cuando llega el XML. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId, APP } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const uuid = randomUUID().toUpperCase(); const tag = `U${Date.now()}`; let expId;
const xml = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="T" Folio="9" Fecha="2026-10-05T12:00:00" SubTotal="171.55" Total="199.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="04">
<cfdi:Emisor Rfc="XAXX010101000" Nombre="Proveedor de prueba"/><cfdi:Receptor Rfc="EKU9003173C9" Nombre="Receptor de prueba"/><cfdi:Impuestos TotalImpuestosTrasladados="27.45"/>
<cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
try {
  let r = await axel.call("/expenses", "POST", { spent_at: "2026-10-13", description: `Factura PDF ${tag}`, amount_minor: 19900, currency: "MXN", cfdi_uuid: uuid.toLowerCase() });
  check("crea el gasto con el folio fiscal", r.status === 201 && r.body.cfdi_uuid_hint === uuid, JSON.stringify(r.body)); expId = r.body.id;
  check("rechaza un folio inválido", (await axel.call("/expenses", "POST", { spent_at: "2026-10-13", description: "x", amount_minor: 1, cfdi_uuid: "no-es-uuid" })).status === 422);
  check("sin XML sigue sin documentar", (await axel.call(`/expenses/${expId}`)).body.cfdi.length === 0);
  const f = new FormData(); f.append("xml", new Blob([xml], { type: "text/xml" }), "cfdi.xml"); f.append("direction", "RECEIVED");
  const res = await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: axel.cookie() }, body: f }); check("se carga el XML", res.status === 201, String(res.status));
  r = await axel.call(`/expenses/${expId}`); check("el gasto quedó ligado solo", r.body.cfdi.length === 1 && r.body.invoicing_status === "INVOICED", JSON.stringify(r.body.cfdi));
} finally {
  const c = await db();
  try {
    await c.query("delete from cfdi_links where cfdi_id in (select id from cfdi_documents where organization_id=$1 and fiscal_uuid=$2)", [meridian, uuid]);
    await c.query("delete from payments where expense_id in (select id from expenses where organization_id=$1 and description like $2)", [meridian, `%${tag}%`]);
    await c.query("delete from expenses where organization_id=$1 and description like $2", [meridian, `%${tag}%`]);
    await c.query("delete from cfdi_documents where organization_id=$1 and fiscal_uuid=$2", [meridian, uuid]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await c.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
