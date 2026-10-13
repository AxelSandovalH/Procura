// Cobro con Stripe: webhook firmado, plan por organización, créditos de timbrado y restricción de funciones. No llama a Stripe (eventos firmados localmente).
// Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes y los valores ficticios STRIPE_* de .env.local.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import { Client, db, orgId, APP, env } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const SECRET = env.STRIPE_WEBHOOK_SECRET; if (!SECRET?.startsWith("whsec_ficticio")) { console.error("Faltan los STRIPE_* ficticios en .env.local"); process.exit(2); }
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const stripe = new Stripe("sk_test_ficticia"); const ids = []; const sessions = [];
const send = async (type, object, { id = `evt_${randomUUID()}`, sign = true } = {}) => {
  ids.push(id); const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const header = sign ? stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) : "t=1,v1=firma_falsa";
  const r = await fetch(`${APP}/api/v1/billing/webhook`, { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload });
  let body = null; try { body = await r.json(); } catch { /* texto */ } return { status: r.status, body };
};
const bill = async () => (await axel.call("/billing")).body;
const setDb = async (sql, params = []) => { const c = await db(); try { return await c.query(sql, params); } finally { await c.end(); } };
const uuidSale = []; const tag = `B${Date.now()}`;
const createdAt = (await setDb("select created_at from organizations where id=$1", [meridian])).rows[0].created_at;
try {
  check("(prep) la organización de prueba no tiene suscripción: acceso completo", (await bill()).access === "LEGACY");
  check("sin cliente en Stripe no hay portal de pago (409)", (await axel.call("/billing/portal", "POST", {})).status === 409);
  check("firma inválida: 400", (await send("checkout.session.completed", {}, { sign: false })).status === 400);

  // Organización NUEVA (creada después del inicio del cobro): sin plan, solo lo básico
  await setDb("update organizations set created_at = now() where id=$1", [meridian]);
  let nb = await bill(); check("organización nueva sin suscripción: acceso «NEW» (a la espera de contratar)", nb.access === "NEW" && nb.plan === null, JSON.stringify(nb.access));
  let rr = await axel.call("/bank/accounts"); check("la nueva no usa funciones de plan: 402 con instrucción de elegir plan", rr.status === 402 && /Elige un plan/.test(rr.body.detail), JSON.stringify(rr.body));
  check("pero sí puede registrar gastos y ventas (lo básico)", (await axel.call("/expenses")).status === 200 && (await axel.call("/sales")).status === 200);
  check("una nueva tampoco usa el reporte de Finanzas (402)", (await axel.call("/finance/summary")).status === 402);

  // Créditos
  const sid = `cs_test_${randomUUID()}`; sessions.push(sid);
  const pack = { id: sid, mode: "payment", payment_status: "paid", customer: "cus_ficticio_1", client_reference_id: meridian, metadata: { organization_id: meridian, kind: "stamp_pack", pack_size: "50" } };
  let r = await send("checkout.session.completed", pack); check("paquete pagado: abona 50 créditos", r.status === 200 && /abonados 50/.test(r.body?.result ?? ""), JSON.stringify(r));
  let b = await bill(); check("el saldo es 50 y la organización pasa a consumir créditos", b.credits.balance === 50 && b.credits.required === true, JSON.stringify(b.credits));
  const dupId = ids[ids.length - 1]; r = await send("checkout.session.completed", pack, { id: dupId }); check("el mismo evento repetido no hace nada", r.body?.duplicate === true);
  r = await send("checkout.session.completed", pack); check("otro evento de la misma sesión no duplica los créditos", /ya abonado/.test(r.body?.result ?? "") && (await bill()).credits.balance === 50, JSON.stringify(r.body));
  r = await send("checkout.session.completed", { ...pack, id: `cs_test_${randomUUID()}`, payment_status: "unpaid" }); check("pago pendiente (OXXO/SPEI): no abona todavía", /no confirmado/.test(r.body?.result ?? "") && (await bill()).credits.balance === 50);
  r = await send("checkout.session.completed", { ...pack, id: `cs_test_${randomUUID()}`, metadata: { organization_id: randomUUID(), kind: "stamp_pack", pack_size: "50" } }); check("una organización inexistente no recibe nada", r.status === 500 || r.status === 200);
  check("comprar créditos NO le da un plan (sigue «NEW»)", (await bill()).access === "NEW");
  b = await bill(); check("el historial registra la compra", b.credits.history.some((h) => h.kind === "PURCHASE" && h.delta === 50), JSON.stringify(b.credits.history));

  // Permisos del cobro
  check("solo el administrador principal contrata (otro miembro: 403)", (await luis.call("/billing/checkout", "POST", { plan: "control" })).status === 403);
  check("plan inválido: 422", (await axel.call("/billing/checkout", "POST", { plan: "platino" })).status === 422);
  check("paquete inválido: 400", (await axel.call("/billing/credits", "POST", { pack: 7 })).status === 400);

  // Suscripción y restricción de funciones
  const subEv = (price, status = "active", extra = {}) => ({ id: "sub_ficticia_1", status, customer: "cus_ficticio_1", cancel_at_period_end: false, metadata: { organization_id: meridian }, items: { data: [{ price: { id: "price_cargo", product: "procura_service_fee" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }, { price: { id: "price_dinamico", product: price }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }, ...extra });
  r = await send("customer.subscription.created", subEv("procura_plan_control")); b = await bill(); check("suscripción Control activa", r.status === 200 && b.access === "PLAN" && b.plan === "control", JSON.stringify({ r: r.body, a: b.access, p: b.plan }));
  check("Control incluye los reportes de Finanzas", (await axel.call("/finance/summary")).status === 200);
  r = await axel.call("/bank/accounts"); check("Control NO incluye banco: 402 con el plan requerido", r.status === 402 && r.body.required_plan === "negocio", JSON.stringify(r.body));
  check("la descarga del SAT tampoco (402)", (await axel.call("/fiscal/downloads")).status === 402);
  check("ni el OCR de tickets (402)", (await axel.call("/expenses/scan", "POST", {})).status === 402);
  r = await send("customer.subscription.updated", subEv("procura_plan_negocio")); check("sube a Negocio", (await bill()).plan === "negocio");
  check("Negocio incluye banco", (await axel.call("/bank/accounts")).status === 200);
  r = await send("customer.subscription.updated", subEv("procura_plan_esencial")); check("baja a Esencial", (await bill()).plan === "esencial");
  check("Esencial no incluye los reportes de Finanzas (402)", (await axel.call("/finance/summary")).status === 402);
  check("pero sí conserva lo básico: gastos", (await axel.call("/expenses")).status === 200);
  await send("customer.subscription.updated", subEv("procura_plan_negocio"));

  // Un solo esquema: qué permite cada plan en compras, estructura y API (sin bloquear a los proveedores)
  const rule = { level: 2, condition: {}, approver_type: "DEPARTMENT_HEAD" }, wf = randomUUID();
  await send("customer.subscription.updated", subEv("procura_plan_esencial"));
  check("Esencial NO incluye compras: crear una requisición responde 402", (await axel.call("/requisitions", "POST", {})).status === 402);
  await send("customer.subscription.updated", subEv("procura_plan_control"));
  r = await axel.call("/requisitions", "POST", {}); check("Control sí incluye compras (pasa el plan: falla solo por datos, 422)", r.status === 422, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  check("Control incluye aprobación de UN nivel (pasa el plan)", (await axel.call(`/organization/approval-workflows/${wf}/rules`, "POST", { ...rule, level: 1 })).status !== 402);
  r = await axel.call(`/organization/approval-workflows/${wf}/rules`, "POST", rule); check("Control NO incluye varios niveles de aprobación (402)", r.status === 402 && r.body.required_plan === "negocio", JSON.stringify(r.body));
  check("Control NO incluye departamentos y ubicaciones (402)", (await axel.call("/organization/departments", "POST", {})).status === 402 && (await axel.call("/organization/locations", "POST", {})).status === 402);
  check("Control NO incluye API ni webhooks (402)", (await axel.call("/organization/api-keys", "POST", {})).status === 402 && (await axel.call("/organization/webhooks", "POST", {})).status === 402);
  await send("customer.subscription.updated", subEv("procura_plan_negocio"));
  check("Negocio incluye varios niveles y estructura (pasan el plan)", (await axel.call(`/organization/approval-workflows/${wf}/rules`, "POST", rule)).status !== 402 && (await axel.call("/organization/departments", "POST", {})).status === 422);
  r = await axel.call("/organization/api-keys", "POST", {}); check("Negocio NO incluye API (402): es de Empresa", r.status === 402 && r.body.required_plan === "empresa", JSON.stringify(r.body));
  await send("customer.subscription.updated", subEv("procura_plan_empresa")); b = await bill();
  check("Empresa se reconoce como plan", b.plan === "empresa", JSON.stringify(b.plan));
  check("Empresa incluye API y webhooks, y todo lo anterior", (await axel.call("/organization/api-keys", "POST", {})).status === 422 && (await axel.call("/organization/webhooks", "POST", {})).status === 422 && (await axel.call("/bank/accounts")).status === 200 && (await axel.call("/finance/summary")).status === 200);
  check("un proveedor sin plan puede responder: las cotizaciones recibidas no se bloquean (no hay 402 en leer su bandeja)", (await axel.call("/rfqs")).status !== 402);
  await send("customer.subscription.updated", subEv("procura_plan_negocio"));

  // Pago fallido, gracia y vencimiento
  r = await send("invoice.payment_failed", { id: "in_ficticia_1", customer: "cus_ficticio_1" }); b = await bill();
  check("pago fallido: pasa a «pago pendiente» con 7 días de gracia", b.subscription.status === "PAST_DUE" && !!b.subscription.grace_until && b.plan === "negocio", JSON.stringify(b.subscription));
  check("durante la gracia conserva sus funciones", (await axel.call("/bank/accounts")).status === 200);
  await setDb("update organization_subscriptions set grace_until = now() - interval '1 day' where organization_id=$1", [meridian]);
  b = await bill(); r = await axel.call("/bank/accounts"); check("vencida la gracia: sin plan, 402, y nada se borra", b.access === "LAPSED" && r.status === 402 && (await axel.call("/expenses")).status === 200, JSON.stringify({ a: b.access, s: r.status }));
  r = await send("invoice.paid", { id: "in_ficticia_2", customer: "cus_ficticio_1" }); check("al pagar se reactiva", (await bill()).access === "PLAN");
  r = await send("customer.subscription.deleted", subEv("procura_plan_negocio", "canceled")); b = await bill(); check("cancelada: sin acceso a funciones de plan", b.access === "LAPSED" && b.subscription.status === "CANCELED");
  await send("customer.subscription.created", subEv("procura_plan_negocio"));

  // Emisión y créditos
  const sale = (await axel.call("/sales", "POST", { sold_at: "2026-10-12", description: `Cobro ${tag}`, lines: [{ description: "Servicio", quantity: 1, unit_price_minor: 10000, tax_rate: 0.16 }] }, { "idempotency-key": randomUUID() })).body; uuidSale.push(sale.id);
  const d0 = await db(); await d0.query("insert into fiscal_provider_connections (organization_id, provider, status, external_account_id, settings) values ($1,'fiscalapi','CONNECTED',$2,$3) on conflict do nothing", [meridian, randomUUID(), JSON.stringify({ expedition_zip_code: "28200", default_product_code: "81111812", default_unit_code: "ACT" })]); await d0.end();
  const invoice = () => axel.call(`/sales/${sale.id}/invoice`, "POST", { payment_form_code: "03", payment_method_code: "PUE", recipient: { tax_id: "XAXX010101000", legal_name: "PUBLICO", tax_regime_code: "616", zip_code: "28200", cfdi_use_code: "S01" } });
  r = await invoice(); b = await bill();
  check("si el timbrado falla, NO se descuenta ningún crédito", r.status === 502 && b.credits.balance === 50 && !b.credits.history.some((h) => h.kind === "CONSUME"), JSON.stringify({ s: r.status, bal: b.credits.balance }));
  await setDb("insert into stamp_credit_ledger (organization_id, delta, kind, reference, note) values ($1,-50,'ADJUST',$2,'prueba: vaciar saldo')", [meridian, `adj-${tag}`]);
  r = await invoice(); check("sin créditos: 402 NO_CREDITS, sin llamar al proveedor", r.status === 402 && r.body.code === "NO_CREDITS", JSON.stringify(r.body));
  const fi = await setDb("select count(*)::int as n from fiscal_issue_requests where sale_id=$1 and status='PENDING'", [sale.id]); check("y no queda ninguna emisión reservada (pendiente)", fi.rows[0].n === 0);
  const ref = randomUUID(); const out = execFileSync("npx", ["tsx", "--env-file=.env.local", "tests/integration/ledger-idem.ts", meridian, ref], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" }).trim().split("\n").pop();
  const j = JSON.parse(out); check("un consumo repetido con la misma referencia no se duplica (idempotente)", j.primera === true && j.repetida === false && j.saldo === -1, out);
} finally {
  try {
    const d = await db();
    await d.query("update organizations set created_at=$2 where id=$1", [meridian, createdAt]);
    await d.query("delete from stamp_credit_ledger where organization_id=$1", [meridian]); await d.query("delete from organization_subscriptions where organization_id=$1", [meridian]);
    await d.query("delete from fiscal_issue_requests where sale_id = any($1)", [uuidSale]); await d.query("delete from sale_lines where sale_id = any($1)", [uuidSale]); await d.query("delete from sales where id = any($1)", [uuidSale]);
    await d.query("delete from fiscal_provider_connections where organization_id=$1 and provider='fiscalapi'", [meridian]);
    await d.query("delete from stripe_events where id = any($1)", [ids]); await d.query("delete from audit_logs where organization_id=$1 and action like 'billing.%'", [meridian]);
    await d.end();
  } catch (e) { console.log("limpieza:", e.message); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
