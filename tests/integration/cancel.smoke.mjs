// Cancelación de CFDI: reglas de la API (permisos, motivo, sustitución, estados). No cancela nada ante el SAT: usa un CFDI con id de proveedor ficticio,
// así que la llamada real al proveedor falla y se comprueba que el CFDI sigue vigente. Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId, APP } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const xml = (uuid, total) => `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="C" Folio="${uuid.slice(0, 4)}" Fecha="2026-10-05T12:00:00" SubTotal="${(total / 1.16).toFixed(2)}" Total="${total.toFixed(2)}" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03">
<cfdi:Emisor Rfc="EKU9003173C9" Nombre="Meridian"/><cfdi:Receptor Rfc="XAXX010101000" Nombre="Cliente de prueba"/><cfdi:Impuestos TotalImpuestosTrasladados="${(total - total / 1.16).toFixed(2)}"/>
<cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
const up = async (u, t) => { const f = new FormData(); f.append("xml", new Blob([xml(u, t)], { type: "text/xml" }), "c.xml"); f.append("direction", "ISSUED"); const r = await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: axel.cookie() }, body: f }); return { status: r.status, body: await r.json().catch(() => null) }; };
const u1 = randomUUID().toUpperCase(), u2 = randomUUID().toUpperCase(), tag = `K${Date.now()}`; let sale, c1, c2;
try {
  let r = await up(u1, 1160); check("carga el CFDI emitido", r.status === 201, JSON.stringify(r.body)); c1 = r.body.id;
  r = await up(u2, 1160); c2 = r.body.id;
  const d = await db(); await d.query("update cfdi_documents set provider='fiscalapi', provider_external_id=$2, source='PROVIDER_ISSUED' where id=$1", [c1, randomUUID()]); await d.end();
  check("solicitante no cancela", (await luis.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "02", confirm: true })).status === 403);
  check("sin confirmar da 422", (await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "02" })).status === 422);
  check("motivo 04 no se admite", (await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "04", confirm: true })).status === 422);
  check("motivo 01 sin sustitución da 422", (await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "01", confirm: true })).status === 422);
  check("motivo 01 con el mismo CFDI da 400", (await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "01", replacement_uuid: u1.toLowerCase(), confirm: true })).status === 400);
  check("motivo 01 con un CFDI que no es nuestro da 400", (await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "01", replacement_uuid: randomUUID(), confirm: true })).status === 400);
  check("un CFDI sin proveedor no se cancela desde Procura (409)", (await axel.call(`/cfdi/${c2}/cancel`, "POST", { reason_code: "02", confirm: true })).status === 409);
  r = await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "02", confirm: true });
  check("si el proveedor falla, responde 502 con el motivo", r.status === 502, JSON.stringify(r.body));
  check("y el CFDI sigue sin cancelarse", ((await axel.call(`/cfdi/${c1}`)).body.sat_status) !== "CANCELANDO");
  const d2 = await db(); await d2.query("update cfdi_documents set sat_status='CANCELANDO' where id=$1", [c1]); await d2.end();
  check("ya en proceso: 409", (await axel.call(`/cfdi/${c1}/cancel`, "POST", { reason_code: "02", confirm: true })).status === 409);
  const idem = randomUUID();
  r = await axel.call("/sales", "POST", { sold_at: "2026-10-05", description: `Venta ${tag}`, lines: [{ description: "Servicio", quantity: 1, unit_price_minor: 100000, tax_rate: 0.16 }] }, { "idempotency-key": idem }); sale = r.body.id;
  check("crea la venta", r.status === 201 && Number(r.body.total_minor) === 116000, JSON.stringify(r.body));
  r = await axel.call(`/sales/${sale}/cfdi`, "POST", { cfdi_id: c1 }); check("no se puede ligar un CFDI en cancelación", r.status >= 400 && r.status < 500, JSON.stringify(r.body));
  r = await axel.call(`/sales/${sale}/cfdi`, "POST", { cfdi_id: c2 }); check("liga un CFDI vigente", r.status === 201 || r.status === 200, JSON.stringify(r.body));
  check("la venta queda facturada", (await axel.call(`/sales/${sale}`)).body.invoicing_status === "INVOICED");
  const { execFileSync } = await import("node:child_process");
  const run = (id, st) => execFileSync("npx", ["tsx", "--env-file=.env.local", "tests/integration/cancel-apply.ts", meridian, id, st], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" }).trim();
  console.log("   (el SAT confirma:", run(c2, "CANCELADO").replace(/\s+/g, " "), ")");
  r = await axel.call(`/sales/${sale}`); check("al cancelarse, la venta ya no cuenta ese CFDI como documentado", r.body.invoicing_status !== "INVOICED" && Number(r.body.documented_minor) === 0, JSON.stringify({ s: r.body.invoicing_status, d: r.body.documented_minor }));
  r = await axel.call(`/cfdi/${c2}`); check("el CFDI queda cancelado con fecha", r.body.sat_status === "CANCELADO" && !!r.body.cancelled_at);
  check("un CFDI cancelado no se vuelve a cancelar (409)", (await axel.call(`/cfdi/${c2}/cancel`, "POST", { reason_code: "02", confirm: true })).status === 409);
  { const dd = await db(); await dd.query("update cfdi_documents set cancel_requested_at = now() where id=$1", [c1]); await dd.end(); }
  run(c1, "VIGENTE"); r = await axel.call(`/cfdi/${c1}`); check("un «Vigente» recién pedida la cancelación no cuenta como rechazo (el SAT aún no se actualiza)", r.body.sat_status === "CANCELANDO", r.body.sat_status);
  { const dd = await db(); await dd.query("update cfdi_documents set cancel_requested_at = now() - interval '2 hours' where id=$1", [c1]); await dd.end(); }
  run(c1, "VIGENTE"); r = await axel.call(`/cfdi/${c1}`); check("si el SAT rechaza, vuelve a vigente y limpia la solicitud", r.body.sat_status === "VIGENTE" && r.body.cancel_reason_code === null);
} finally {
  const d = await db();
  try {
    await d.query("delete from cfdi_links where cfdi_id = any($1)", [[c1, c2].filter(Boolean)]);
    if (sale) { await d.query("delete from sale_lines where sale_id=$1", [sale]); await d.query("delete from sales where id=$1", [sale]); }
    await d.query("delete from cfdi_documents where id = any($1)", [[c1, c2].filter(Boolean)]);
    await d.query("delete from audit_logs where resource_label = any($1) and action like 'cfdi.%'", [[u1, u2]]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
