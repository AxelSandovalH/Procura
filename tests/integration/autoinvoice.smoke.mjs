// Portal público de autofacturación: configuración, búsqueda por folio+total, candados (plazo, tope diario, ya facturado), validación y errores seguros.
// No timbra nada real: el proveedor falla (credenciales de otro ambiente) y se comprueba que el cliente solo ve un mensaje genérico. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId, APP } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const anon = new Client("anon");
const tag = `A${Date.now()}`; const created = { sales: [] };
const d0 = await db(); const slug = (await d0.query("select slug from organizations where id=$1", [meridian])).rows[0].slug;
const hadConn = (await d0.query("select 1 from fiscal_provider_connections where organization_id=$1 and provider='fiscalapi'", [meridian])).rowCount > 0;
const prevCfg = (await d0.query("select external_account_id, settings from fiscal_provider_connections where organization_id=$1 and provider='fiscalapi'", [meridian])).rows[0]; await d0.end();
const recipient = { tax_id: "XAXX010101000", legal_name: "CLIENTE DE PRUEBA", tax_regime_code: "616", zip_code: "28200", cfdi_use_code: "S01", email: "cliente@example.com" };
const sale = async (sold_at, desc, price = 10000) => { const r = await axel.call("/sales", "POST", { sold_at, description: `${desc} ${tag}`, payment_method: "CARD", lines: [{ description: "Café", quantity: 2, unit_price_minor: price, tax_rate: 0.16 }] }, { "idempotency-key": randomUUID() }); created.sales.push(r.body.id); return r.body; };
try {
  const dis = await anon.call(`/portal/${slug}/autoinvoice`); check("apagado: el portal no existe para el público (404)", dis.status === 404);
  check("solicitante no configura el portal", (await luis.call("/organization/autoinvoice", "PUT", { enabled: true })).status === 403);
  const d1 = await db(); await d1.query("delete from fiscal_provider_connections where organization_id=$1 and provider='fiscalapi'", [meridian]); await d1.end();
  let r = await axel.call("/organization/autoinvoice", "PUT", { enabled: true }); check("no se enciende sin emisor fiscal (409)", r.status === 409, JSON.stringify(r.body));
  const d2 = await db(); await d2.query("insert into fiscal_provider_connections (organization_id, provider, status, external_account_id, settings) values ($1,'fiscalapi','CONNECTED',$2,$3)", [meridian, randomUUID(), JSON.stringify({ expedition_zip_code: "28200" })]); await d2.end();
  r = await axel.call("/organization/autoinvoice", "PUT", { enabled: true }); check("no se enciende sin claves SAT por omisión (409)", r.status === 409);
  const d3 = await db(); await d3.query("update fiscal_provider_connections set settings = settings || $2::jsonb where organization_id=$1 and provider='fiscalapi'", [meridian, JSON.stringify({ default_product_code: "90101501", default_unit_code: "E48" })]); await d3.end();
  r = await axel.call("/organization/autoinvoice", "PUT", { enabled: true, window_days: 30, daily_limit: 5, welcome_text: "Hola" }); check("se enciende con todo configurado", r.status === 200 && r.body.enabled === true, JSON.stringify(r.body));

  r = await anon.call(`/portal/${slug}/autoinvoice`); check("encendido: información pública sin sesión", r.status === 200 && r.body.portal.display_name && r.body.portal.welcome_text === "Hola" && !("organization_id" in r.body.portal), JSON.stringify(r.body));
  const s1 = await sale("2026-10-10", "Mostrador"); const folio = s1.folio, total = (Number(s1.total_minor) / 100).toFixed(2);
  r = await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio, total }); check("folio y total exactos: encuentra el ticket", r.status === 200 && r.body.folio === folio && r.body.payment_form_code === "04" && r.body.lines.length === 1, JSON.stringify(r.body));
  const bad1 = await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio, total: "1.00" }), bad2 = await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio: "NOEXISTE", total });
  check("total o folio incorrectos dan la misma respuesta (no se adivina)", bad1.status === 404 && bad2.status === 404 && bad1.body.detail === bad2.body.detail);
  check("el folio no distingue mayúsculas", (await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio: folio.toLowerCase(), total: `$${total}` })).status === 200);

  const body = (o = {}) => ({ folio, total, payment_form_code: "04", accept: true, recipient, ...o });
  check("sin aceptar los datos: 422", (await anon.call(`/portal/${slug}/autoinvoice/issue`, "POST", body({ accept: false }))).status === 422);
  check("RFC con formato inválido: 422", (await anon.call(`/portal/${slug}/autoinvoice/issue`, "POST", body({ recipient: { ...recipient, tax_id: "123" } }))).status === 422);
  check("correo inválido: 422", (await anon.call(`/portal/${slug}/autoinvoice/issue`, "POST", body({ recipient: { ...recipient, email: "no" } }))).status === 422);
  r = await anon.call(`/portal/${slug}/autoinvoice/issue`, "POST", body());
  check("si el proveedor falla, el cliente ve un mensaje genérico (sin detalles internos)", r.status === 503 && /no puede emitir facturas/i.test(r.body.detail) && !/fiscalapi|credencial|tenant|api key/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const d4 = await db(); const reqs = (await d4.query("select status, source, requester_email, requester_ip_hash from fiscal_issue_requests where sale_id=$1", [s1.id])).rows; await d4.end();
  check("queda registrado el intento (portal, correo, IP con hash) y sin timbrar", reqs.length === 1 && reqs[0].status === "FAILED" && reqs[0].source === "PORTAL" && reqs[0].requester_email === recipient.email && reqs[0].requester_ip_hash?.length === 32 && !String(reqs[0].requester_ip_hash).includes("."), JSON.stringify(reqs));

  const old = await sale("2026-01-05", "Antiguo"); r = await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio: old.folio, total: (Number(old.total_minor) / 100).toFixed(2) });
  check("fuera del plazo: 409 con el aviso", r.status === 409 && /plazo/i.test(r.body.detail), JSON.stringify(r.body));
  const s2 = await sale("2026-10-11", "Ya facturado"); const d5 = await db(); await d5.query("insert into fiscal_issue_requests (organization_id, sale_id, provider, status, source) values ($1,$2,'fiscalapi','DONE','USER')", [meridian, s2.id]); await d5.end();
  r = await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio: s2.folio, total: (Number(s2.total_minor) / 100).toFixed(2) }); check("ticket ya facturado: 409", r.status === 409 && /ya fue facturado/i.test(r.body.detail), JSON.stringify(r.body));

  await axel.call("/organization/autoinvoice", "PUT", { daily_limit: 1 });
  const s3 = await sale("2026-10-11", "Tope"), s4 = await sale("2026-10-12", "Tope 2"); const d6 = await db(); await d6.query("insert into fiscal_issue_requests (organization_id, sale_id, provider, status, source) values ($1,$2,'fiscalapi','DONE','PORTAL')", [meridian, s3.id]); await d6.end();
  r = await anon.call(`/portal/${slug}/autoinvoice/issue`, "POST", body({ folio: s4.folio, total: (Number(s4.total_minor) / 100).toFixed(2) })); check("tope diario alcanzado: 429", r.status === 429, JSON.stringify(r.body));
  check("el solicitante no cambia el portal", (await luis.call("/organization/autoinvoice", "PUT", { enabled: false })).status === 403);
  await axel.call("/organization/autoinvoice", "PUT", { enabled: false }); check("apagado de nuevo: 404 al público", (await anon.call(`/portal/${slug}/autoinvoice/lookup`, "POST", { folio, total })).status === 404);
  const page = await fetch(`${APP}/${slug}/facturar`, { redirect: "manual" }); check("la página /facturar es pública (sin redirigir al login)", page.status === 200, String(page.status));
} finally {
  const d = await db();
  try {
    await d.query("delete from fiscal_issue_requests where sale_id = any($1)", [created.sales]);
    await d.query("delete from sale_lines where sale_id = any($1)", [created.sales]); await d.query("delete from sales where id = any($1)", [created.sales]);
    await d.query("delete from autoinvoice_settings where organization_id=$1", [meridian]);
    await d.query("delete from fiscal_provider_connections where organization_id=$1 and provider='fiscalapi'", [meridian]);
    if (hadConn) await d.query("insert into fiscal_provider_connections (organization_id, provider, status, external_account_id, settings) values ($1,'fiscalapi','CONNECTED',$2,$3)", [meridian, prevCfg.external_account_id, JSON.stringify(prevCfg.settings)]);
    await d.query("delete from audit_logs where organization_id=$1 and action='organization.autoinvoice_updated'", [meridian]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
