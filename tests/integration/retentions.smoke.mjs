// Facturas con retenciones (RESICO): el CFDI neto documenta la venta completa, y el cliente solo paga el neto. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId, APP } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const u = randomUUID().toUpperCase(), tag = `R${Date.now()}`; let sale, cfdi, sale2, cfdi2; const u2 = randomUUID().toUpperCase();
const mk = (uuid) => `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="R" Folio="1" Fecha="2026-10-12T13:10:00" SubTotal="16717.38" Total="17400.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03"><cfdi:Emisor Rfc="EKU9003173C9" Nombre="Meridian"/><cfdi:Receptor Rfc="PYR240827SC0" Nombre="PAPILLON"/><cfdi:Impuestos TotalImpuestosRetenidos="1992.16" TotalImpuestosTrasladados="2674.78"><cfdi:Retenciones><cfdi:Retencion Impuesto="002" Importe="1783.19"/><cfdi:Retencion Impuesto="001" Importe="208.97"/></cfdi:Retenciones></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
const xml = mk(u);
try {
  const f = new FormData(); f.append("xml", new Blob([xml], { type: "text/xml" }), "c.xml"); f.append("direction", "ISSUED");
  let r = await (await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: axel.cookie() }, body: f })).json(); cfdi = r.id;
  r = await axel.call(`/cfdi/${cfdi}`); check("el CFDI guarda lo retenido y puede documentar subtotal + IVA", Number(r.body.retained_minor) === 199216 && Number(r.body.total_minor) === 1740000 && Number(r.body.pending_to_allocate_minor) === 1939216, JSON.stringify({ r: r.body.retained_minor, p: r.body.pending_to_allocate_minor }));
  r = await axel.call("/sales", "POST", { sold_at: "2026-10-12", description: `Mantenimiento ${tag}`, lines: [{ description: "MANTENIMIENTO", quantity: 1, unit_price_minor: 1671738, tax_rate: 0.16 }] }, { "idempotency-key": randomUUID() }); sale = r.body.id;
  check("la venta bruta es 19,392.16", Number(r.body.total_minor) === 1939216, String(r.body.total_minor));
  r = await axel.call(`/sales/${sale}/cfdi`, "POST", { cfdi_id: cfdi }); check("liga el CFDI neto a la venta completa", r.status === 201 || r.status === 200, JSON.stringify(r.body));
  r = await axel.call(`/sales/${sale}`); check("la venta queda FACTURADA (no «parcial»)", r.body.invoicing_status === "INVOICED" && Number(r.body.documented_minor) === 1939216, JSON.stringify({ s: r.body.invoicing_status, d: r.body.documented_minor }));
  check("lo que se cobra es el neto: 17,400.00 (el cliente retiene 1,992.16)", Number(r.body.withheld_minor) === 199216 && Number(r.body.pending_to_collect_minor) === 1740000, JSON.stringify({ w: r.body.withheld_minor, p: r.body.pending_to_collect_minor }));
  check("no se puede cobrar más que el neto", (await axel.call(`/sales/${sale}/payments`, "POST", { paid_at: "2026-10-13", amount_minor: 1939216 })).status === 400);
  r = await axel.call(`/sales/${sale}/payments`, "POST", { paid_at: "2026-10-13", amount_minor: 1740000, method: "TRANSFER" }); check("cobra el neto", r.status === 201 || r.status === 200, JSON.stringify(r.body));
  r = await axel.call(`/sales/${sale}`); check("la venta queda COBRADA", r.body.collection_status === "COLLECTED" && Number(r.body.pending_to_collect_minor) === 0, JSON.stringify({ c: r.body.collection_status, p: r.body.pending_to_collect_minor }));
  r = await axel.call("/finance/summary?from=2026-10-01&to=2026-10-31"); const mx = r.body.by_currency.MXN; check("el resumen no cuenta lo retenido como por cobrar", Number(mx.receivable.total_minor) === 0 || !JSON.stringify(mx.receivable).includes("199216"));
  const sinRet = await axel.call(`/sales/${sale}/invoice`, "POST", { payment_form_code: "03", payment_method_code: "PUE", retentions: { isr: true, iva: false }, recipient: { tax_id: "XAXX010101000", legal_name: "PUBLICO", tax_regime_code: "616", zip_code: "28200", cfdi_use_code: "S01" } });
  check("emitir con retenciones a persona física se rechaza (o la venta ya está facturada)", sinRet.status >= 400 && sinRet.status < 500, JSON.stringify(sinRet.body));

  // Escenario B: se cobró 15,000 + IVA = 17,400 y la venta se registró así (igual al neto del CFDI, sin volver a restar retenciones).
  const f2 = new FormData(); f2.append("xml", new Blob([mk(u2)], { type: "text/xml" }), "c.xml"); f2.append("direction", "ISSUED");
  cfdi2 = (await (await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: axel.cookie() }, body: f2 })).json()).id;
  r = await axel.call("/sales", "POST", { sold_at: "2026-10-12", description: `Acordado ${tag}`, lines: [{ description: "MANTENIMIENTO", quantity: 1, unit_price_minor: 1500000, tax_rate: 0.16 }] }, { "idempotency-key": randomUUID() }); sale2 = r.body.id;
  check("B: la venta registrada por lo acordado es 17,400.00", Number(r.body.total_minor) === 1740000, String(r.body.total_minor));
  r = await axel.call(`/sales/${sale2}/cfdi`, "POST", { cfdi_id: cfdi2 }); check("B: liga el CFDI", r.status === 201 || r.status === 200, JSON.stringify(r.body));
  r = await axel.call(`/sales/${sale2}`); check("B: queda facturada y no se resta nada más", r.body.invoicing_status === "INVOICED" && Number(r.body.withheld_minor) === 0 && Number(r.body.pending_to_collect_minor) === 1740000, JSON.stringify({ s: r.body.invoicing_status, w: r.body.withheld_minor, p: r.body.pending_to_collect_minor }));
  r = await axel.call(`/sales/${sale2}/payments`, "POST", { paid_at: "2026-10-13", amount_minor: 1740000, method: "TRANSFER" }); check("B: cobra los 17,400.00 que transfirieron", r.status === 201 || r.status === 200, JSON.stringify(r.body));
  check("B: queda cobrada", (await axel.call(`/sales/${sale2}`)).body.collection_status === "COLLECTED");
} finally {
  const d = await db();
  try { await d.query("delete from payments where sale_id = any($1)", [[sale, sale2].filter(Boolean)]); await d.query("delete from cfdi_links where cfdi_id = any($1)", [[cfdi, cfdi2].filter(Boolean)]); await d.query("delete from sale_lines where sale_id = any($1)", [[sale, sale2].filter(Boolean)]); await d.query("delete from sales where id = any($1)", [[sale, sale2].filter(Boolean)]); await d.query("delete from cfdi_documents where id = any($1)", [[cfdi, cfdi2].filter(Boolean)]); await d.query("delete from audit_logs where resource_label = any($1)", [[u, u2]]); } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
