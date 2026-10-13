// Exportaciones para el equipo contable (CSV y ZIP de XML) y clientes con datos fiscales. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { Client, db, orgId, APP } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const get = async (who, q) => { const r = await fetch(`${APP}/api/v1/finance/export?${q}`, { headers: { cookie: who.cookie() } }); return { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), buf: Buffer.from(await r.arrayBuffer()) }; };
const tag = `X${Date.now()}`, uuid = randomUUID().toUpperCase(); let exp, sale, cfdi, cust;
const xml = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="E" Folio="7" Fecha="2026-10-12T10:00:00" SubTotal="100.00" Total="116.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03"><cfdi:Emisor Rfc="XAXX010101000" Nombre="Proveedor"/><cfdi:Receptor Rfc="EKU9003173C9" Nombre="Meridian"/><cfdi:Impuestos TotalImpuestosTrasladados="16.00"/><cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
try {
  exp = (await axel.call("/expenses", "POST", { spent_at: "2026-10-12", description: `=HYPERLINK("http://x") ${tag}`, amount_minor: 12345, currency: "MXN", supplier_name: "Papelería, \"El Sol\"", category: "Oficina" })).body.id;
  sale = (await axel.call("/sales", "POST", { sold_at: "2026-10-12", description: `Venta ${tag}`, lines: [{ description: "Servicio", quantity: 1, unit_price_minor: 100000, tax_rate: 0.16 }] }, { "idempotency-key": randomUUID() })).body.id;
  const f = new FormData(); f.append("xml", new Blob([xml], { type: "text/xml" }), "c.xml"); f.append("direction", "RECEIVED");
  cfdi = (await (await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: axel.cookie() }, body: f })).json()).id;
  const q = (t) => `type=${t}&from=2026-10-01&to=2026-10-31`;
  let r = await get(axel, q("gastos")); let txt = r.buf.toString("utf8");
  check("CSV de gastos: tipo, nombre de archivo y BOM de UTF-8", r.status === 200 && /text\/csv/.test(r.type) && /procura-gastos-2026-10-01_2026-10-31\.csv/.test(r.disp) && txt.charCodeAt(0) === 0xfeff, `${r.status} ${r.disp}`);
  check("incluye el gasto con su monto en pesos y el proveedor con comillas escapadas", txt.includes("123.45") && txt.includes('"Papelería, ""El Sol"""'));
  check("una descripción que parece fórmula queda neutralizada", txt.includes("\"'=HYPERLINK(") || txt.includes("'=HYPERLINK("), txt.split("\n").find((l) => l.includes(tag)));
  r = await get(axel, q("ventas")); txt = r.buf.toString("utf8"); check("CSV de ventas con subtotal, IVA y total", r.status === 200 && txt.includes("1000") && txt.includes("1160") && txt.includes("Pendiente de cobro"));
  r = await get(axel, q("cfdi_recibidos")); txt = r.buf.toString("utf8"); check("CSV de CFDI recibidos con UUID, RFC y total", r.status === 200 && txt.includes(uuid) && txt.includes("XAXX010101000") && txt.includes("116"));
  check("los emitidos no incluyen los recibidos", !(await get(axel, q("cfdi_emitidos"))).buf.toString("utf8").includes(uuid));
  for (const t of ["pagos", "banco"]) { r = await get(axel, q(t)); check(`CSV de ${t}: encabezado correcto aunque no haya filas`, r.status === 200 && r.buf.toString("utf8").split("\r\n")[0].includes("Fecha")); }
  r = await get(axel, q("xml_recibidos")); const zip = r.status === 200 ? await JSZip.loadAsync(r.buf) : null;
  check("ZIP de XML recibidos con el XML y el índice", r.status === 200 && /zip/.test(r.type) && !!zip?.file(`${uuid}.xml`) && !!zip?.file("indice.csv"), `${r.status}`);
  check("un periodo sin XML da 404", (await get(axel, "type=xml_emitidos&from=2020-01-01&to=2020-01-31")).status === 404);
  check("tipo inválido: 400", (await get(axel, "type=todo&from=2026-10-01&to=2026-10-31")).status === 400);
  check("fechas invertidas: 400", (await get(axel, "type=gastos&from=2026-10-31&to=2026-10-01")).status === 400);
  check("periodo mayor a 400 días: 400", (await get(axel, "type=gastos&from=2024-01-01&to=2026-10-31")).status === 400);
  check("quien no ve finanzas no exporta (403)", (await get(luis, q("gastos"))).status === 403);
  const d = await db(); const log = await d.query("select count(*)::int as n from audit_logs where organization_id=$1 and action='finance.exported'", [meridian]); await d.end(); check("cada exportación queda en la bitácora", log.rows[0].n >= 5, String(log.rows[0].n));

  // Clientes con datos fiscales
  let c = await axel.call("/customers", "POST", { name: `Cliente ${tag}`, tax_id: "pyr240827sc0", tax_regime_code: "601", zip_code: "23450", cfdi_use_code: "G03" }); cust = c.body.id;
  check("crea el cliente con RFC en mayúsculas y datos fiscales", c.status === 201 && c.body.tax_id === "PYR240827SC0" && c.body.tax_regime_code === "601", JSON.stringify(c.body));
  check("RFC inválido: 422", (await axel.call("/customers", "POST", { name: "x", tax_id: "123" })).status === 422);
  c = await axel.call(`/customers/${cust}`, "PATCH", { zip_code: "28200", email: "cliente@example.com" }); check("edita sus datos fiscales", c.status === 200 && c.body.zip_code === "28200" && c.body.email === "cliente@example.com", JSON.stringify(c.body));
  check("quien no gestiona ventas no edita (403)", (await luis.call(`/customers/${cust}`, "PATCH", { zip_code: "11111" })).status === 403);
  check("archiva sin borrar", (await axel.call(`/customers/${cust}`, "PATCH", { archived: true })).status === 200 && !((await axel.call("/customers")).body.data ?? []).some((x) => x.id === cust));
} finally {
  const d = await db();
  try { await d.query("delete from cfdi_documents where id=$1", [cfdi]); await d.query("delete from sale_lines where sale_id=$1", [sale]); await d.query("delete from sales where id=$1", [sale]); await d.query("delete from expenses where id=$1", [exp]); await d.query("delete from customers where id=$1", [cust]); await d.query("delete from audit_logs where organization_id=$1 and (action in ('finance.exported','customer.created','customer.updated','customer.archived'))", [meridian]); } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
