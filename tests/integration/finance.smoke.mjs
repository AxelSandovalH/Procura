// Prueba de integración del módulo financiero (ventas, cobros, CFDI, gastos, resumen, aislamiento y permisos).
// Requiere el servidor en marcha (npm run dev) y el escenario de demostración «Meridian Yachts».
// Escribe datos de prueba y los retira al terminar. Exige PROCURA_TEST_CONFIRM=yes porque usa la base de .env.local.
import { randomUUID } from "node:crypto";
import { Client, db, orgId, APP, env } from "./client.mjs";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes para confirmar que puedes escribir datos de prueba en la base de .env.local."); process.exit(2); }

let r; let pass = 0, fail = 0; const failures = [];
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log("  ✔", name); } else { fail++; failures.push(name); console.log("  ✘", name, extra); } };
const D = (b) => Number(b); // bigint serializado como número por la API

const cfdiXml = (uuid, sub, total, { rfcE = "XAXX010101000", rfcR = "EKU9003173C9", tipo = "I" } = {}) => `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="T" Folio="${uuid.slice(0, 4)}" Fecha="2026-10-05T12:00:00" SubTotal="${sub}" Total="${total}" Moneda="MXN" TipoDeComprobante="${tipo}" MetodoPago="PUE" FormaPago="03">
<cfdi:Emisor Rfc="${rfcE}" Nombre="Emisor de prueba"/><cfdi:Receptor Rfc="${rfcR}" Nombre="Receptor de prueba"/><cfdi:Impuestos TotalImpuestosTrasladados="${(total - sub).toFixed(2)}"/>
<cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
const upload = async (who, xml, direction) => {
  const f = new FormData(); f.append("xml", new Blob([xml], { type: "text/xml" }), "cfdi.xml"); if (direction) f.append("direction", direction);
  const res = await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: who.cookie() }, body: f }); let body = null; try { body = await res.json(); } catch { /* */ }
  return { status: res.status, body };
};

const meridian = await orgId("Meridian Yachts"), golfo = await orgId("Refacciones Marinas del Golfo");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);       // Solicitante: sin permisos financieros
const ricardo = await new Client("ricardo").loginMagic("ventas@refaccionesdelgolfo-demo.example.com"); await ricardo.useOrg(golfo); // otra organización
const created = { sales: [], expenses: [], cfdi: [], invoices: [] };
const tag = `T${Date.now()}`;
const U = () => randomUUID().toUpperCase();

try {
  console.log("Ventas: cálculo y estados");
  const body = { sold_at: "2026-10-06", description: `Comida de prueba ${tag}`, payment_method: "CARD", lines: [
    { description: "Platillo", quantity: 3, unit_price_minor: 15000, tax_rate: 0.16 }, { description: "Bebida", quantity: 2, unit_price_minor: 5000, discount_minor: 1000, tax_rate: 0.16 } ] };
  const idem = randomUUID();
  r = await axel.call("/sales", "POST", body, { "idempotency-key": idem }); const sale = r.body; created.sales.push(sale?.id);
  check("crea la venta (201)", r.status === 201, JSON.stringify(r.body)?.slice(0, 200));
  const gross = 45000 + 10000, tax = Math.round(45000 * 0.16) + Math.round(9000 * 0.16), total = gross - 1000 + tax;
  check("subtotal, descuento, impuestos y total correctos", D(sale.subtotal_minor) === gross && D(sale.discount_minor) === 1000 && D(sale.tax_minor) === tax && D(sale.total_minor) === total, `${sale.subtotal_minor}/${sale.tax_minor}/${sale.total_minor}`);
  check("nace pendiente de cobro y sin facturar", sale.collection_status === "PENDING" && sale.invoicing_status === "NONE");
  const again = await axel.call("/sales", "POST", body, { "idempotency-key": idem });
  check("idempotencia: el reintento devuelve la misma venta", again.body?.id === sale.id);

  console.log("Cobros parciales");
  r = await axel.call(`/sales/${sale.id}/payments`, "POST", { paid_at: "2026-10-06", amount_minor: 10000, method: "CASH" });
  check("cobro parcial → PARCIAL", r.status === 201 && r.body.collection_status === "PARTIAL" && D(r.body.pending_to_collect_minor) === total - 10000);
  r = await axel.call(`/sales/${sale.id}/payments`, "POST", { paid_at: "2026-10-06", amount_minor: total });
  check("un cobro que excede lo pendiente se rechaza", r.status === 400);
  check("la venta sigue sin facturar aunque esté parcialmente cobrada", (await axel.call(`/sales/${sale.id}`)).body.invoicing_status === "NONE");

  console.log("CFDI emitidos y vinculación");
  const u1 = U(); r = await upload(axel, cfdiXml(u1, ((total - tax) / 100).toFixed(2), (total / 100).toFixed(2)), "ISSUED"); created.cfdi.push(r.body?.id);
  check("carga manual de un CFDI emitido (201)", r.status === 201 && r.body.direction === "ISSUED", JSON.stringify(r.body)?.slice(0, 160));
  const dup = await upload(axel, cfdiXml(u1, "1.00", "1.16"), "ISSUED"); check("UUID repetido → 409", dup.status === 409);
  const egreso = await upload(axel, cfdiXml(U(), "1.00", "1.16", { tipo: "E" }), "ISSUED"); created.cfdi.push(egreso.body?.id);
  check("un CFDI de egreso se puede cargar como documento…", egreso.status === 201);
  const cfdi1 = r.body;
  check("…pero no documenta una venta (solo ingreso)", (await axel.call(`/sales/${sale.id}/cfdi`, "POST", { cfdi_id: egreso.body.id })).status === 400);
  r = await axel.call(`/sales/${sale.id}/cfdi`, "POST", { cfdi_id: cfdi1.id });
  check("vincular CFDI → FACTURADA y el cobro sigue PARCIAL", r.status === 201 && r.body.invoicing_status === "INVOICED" && r.body.collection_status === "PARTIAL", r.body?.detail);
  check("importe documentado = total y sin pendiente", D(r.body.documented_minor) === total && D(r.body.pending_to_document_minor) === 0);
  check("no se duplica la misma vinculación", (await axel.call(`/sales/${sale.id}/cfdi`, "POST", { cfdi_id: cfdi1.id })).status === 409);
  const linkId = r.body.cfdi[0].id;
  r = await axel.call(`/sales/${sale.id}/cfdi/${linkId}`, "DELETE", { reason: "Prueba de desvinculación" });
  check("desvincular exige motivo y regresa a SIN FACTURAR", r.status === 200 && r.body.invoicing_status === "NONE");
  check("desvincular sin motivo se rechaza (422)", (await axel.call(`/sales/${sale.id}/cfdi/${linkId}`, "DELETE", {})).status === 422);

  console.log("Facturación parcial y un CFDI para varias operaciones");
  const uA = U(), uB = U();
  const A = (await upload(axel, cfdiXml(uA, "100.00", "116.00"), "ISSUED")).body, B = (await upload(axel, cfdiXml(uB, ((total - tax) / 100).toFixed(2), (total / 100).toFixed(2)), "ISSUED")).body; created.cfdi.push(A?.id, B?.id);
  r = await axel.call(`/sales/${sale.id}/cfdi`, "POST", { cfdi_id: A.id, amount_minor: 11600 });
  check("un CFDI menor deja la venta en facturación PARCIAL", r.body.invoicing_status === "PARTIAL" && D(r.body.pending_to_document_minor) === total - 11600, JSON.stringify(r.body)?.slice(0, 150));
  r = await axel.call(`/sales/${sale.id}/cfdi`, "POST", { cfdi_id: B.id, amount_minor: total * 2 });
  check("un importe mayor a lo que falta se rechaza", r.status === 400);
  r = await axel.call(`/sales/${sale.id}/cfdi`, "POST", { cfdi_id: B.id });
  check("el segundo CFDI completa lo faltante → FACTURADA", r.status === 201 && r.body.invoicing_status === "INVOICED", r.body?.detail);
  const sale2 = (await axel.call("/sales", "POST", { sold_at: "2026-10-06", description: `Segunda ${tag}`, lines: [{ description: "x", quantity: 1, unit_price_minor: 5000 }] })).body; created.sales.push(sale2.id);
  const shared = (await axel.call(`/sales/${sale2.id}/cfdi`, "POST", { cfdi_id: B.id })).body;
  check("el mismo CFDI puede documentar otra operación solo con lo que le queda", shared?.status === undefined && D(shared?.documented_minor ?? 0) <= 5000);
  check("el importe documentado del CFDI queda registrado", (await axel.call(`/cfdi/${B.id}`)).body.links.length === 2);

  console.log("Anulaciones");
  check("no se anula una venta con cobros vigentes", (await axel.call(`/sales/${sale.id}/void`, "POST", { reason: "x" })).status === 409);
  const pid = (await axel.call(`/sales/${sale.id}`)).body.payments[0].id;
  r = await axel.call(`/sales/${sale.id}/payments/${pid}/void`, "POST", { reason: "Prueba" });
  check("anular el cobro recalcula el estado → PENDIENTE", r.body.collection_status === "PENDING");

  console.log("Gastos: pagos y CFDI recibidos");
  const ex = (await axel.call("/expenses", "POST", { spent_at: "2026-10-06", description: `Gasto ${tag}`, amount_minor: 23200, currency: "MXN", category: "Insumos" })).body; created.expenses.push(ex?.id);
  check("crea el gasto (pendiente de pago, sin factura)", ex?.payment_status === "PENDING" && ex?.invoicing_status === "NONE");
  r = await axel.call(`/expenses/${ex.id}/payments`, "POST", { paid_at: "2026-10-06", amount_minor: 10000 });
  check("pago parcial del gasto", r.status === 201 && r.body.payment_status === "PARTIAL" && D(r.body.pending_to_pay_minor) === 13200);
  const rec = (await upload(axel, cfdiXml(U(), "200.00", "232.00", { rfcE: "AAA010101AAA", rfcR: "EKU9003173C9" }), "RECEIVED")).body; created.cfdi.push(rec?.id);
  r = await axel.call(`/expenses/${ex.id}/cfdi`, "POST", { cfdi_id: rec.id });
  check("vincula un CFDI recibido → facturado; el pago sigue parcial", r.status === 201 && r.body.invoicing_status === "INVOICED" && r.body.payment_status === "PARTIAL", r.body?.detail);
  check("un CFDI emitido no puede documentar un gasto", (await axel.call(`/expenses/${ex.id}/cfdi`, "POST", { cfdi_id: A.id })).status === 400);
  check("una venta no se documenta con un CFDI recibido", (await axel.call(`/sales/${sale2.id}/cfdi`, "POST", { cfdi_id: rec.id })).status === 400);

  console.log("Factura del proveedor en una orden ↔ CFDI (fuente única)");
  const cdb = await db(); const ord = (await cdb.query("select id, total_minor from orders where buyer_organization_id=$1 and supplier_organization_id=$2 and status='COMPLETED' limit 1", [meridian, golfo])).rows[0]; await cdb.end();
  if (!ord) check("hay una orden completada para probar", false);
  else {
    const uInv = U(); const f = new FormData(); f.append("xml", new Blob([cfdiXml(uInv, "10.00", "11.60", { rfcE: "XAXX010101000", rfcR: "EKU9003173C9" })], { type: "text/xml" }), "factura.xml");
    const res = await fetch(`${APP}/api/v1/orders/${ord.id}/invoices`, { method: "POST", headers: { cookie: ricardo.cookie() }, body: f }); const inv = await res.json(); created.invoices.push(inv?.invoice?.id);
    check("el proveedor adjunta su factura a la orden (201)", res.status === 201, JSON.stringify(inv)?.slice(0, 160));
    const issued = (await ricardo.call("/cfdi?direction=ISSUED&q=" + uInv)).body?.data ?? [];
    check("queda como CFDI EMITIDO en la organización del proveedor", issued.length === 1 && issued[0].source === "SUPPLIER_ORDER");
    const recvList = (await axel.call("/cfdi?direction=RECEIVED&q=" + uInv)).body?.data ?? [];
    check("el comprador la ve como CFDI RECIBIDO (copia propia)", recvList.length === 1 && recvList[0].direction === "RECEIVED"); created.cfdi.push(recvList[0]?.id, issued[0]?.id);
    const ex2 = (await axel.call("/expenses", "POST", { spent_at: "2026-10-06", description: `Gasto factura ${tag}`, amount_minor: 1160, cfdi_ids: [recvList[0].id] })).body; created.expenses.push(ex2?.id);
    check("un gasto se documenta con esa misma factura", ex2?.invoicing_status === "INVOICED" && ex2?.cfdi?.length === 1);
    check("no se rechaza la factura mientras documenta un gasto (409)", (await axel.call(`/invoices/${inv.invoice.id}/reject`, "POST", { reason: "prueba" })).status === 409);
    const unl = await axel.call(`/expenses/${ex2.id}/cfdi/${ex2.cfdi[0].id}`, "DELETE", { reason: "prueba" });
    check("se desvincula y el gasto queda sin facturar", unl.status === 200 && unl.body.invoicing_status === "NONE");
    check("el comprador rechaza la factura", (await axel.call(`/invoices/${inv.invoice.id}/reject`, "POST", { reason: "prueba" })).status === 200);
    check("al rechazarse, el comprador ya no conserva ese CFDI recibido", ((await axel.call("/cfdi?direction=RECEIVED&q=" + uInv)).body?.data ?? []).length === 0);
  }

  console.log("Carga masiva (XML + PDF + ZIP) y gastos desde CFDI");
  const b1 = U(), b2 = U(), b3 = U();
  const zip = new JSZip(); zip.file("carpeta/uno.xml", cfdiXml(b1, "100.00", "116.00", { rfcE: "AAA010101AAA", rfcR: "EKU9003173C9" })); zip.file("carpeta/uno.pdf", "%PDF-1.4 prueba"); zip.file("dos.xml", cfdiXml(b2, "200.00", "232.00", { rfcE: "AAA010101AAA", rfcR: "EKU9003173C9" })); zip.file("roto.xml", "<html>no es cfdi</html>"); zip.file("notas.txt", "x");
  const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
  const bulk = async (fileList, dir) => { const f = new FormData(); for (const [n, b, t] of fileList) f.append("files", new Blob([b], { type: t }), n); if (dir) f.append("direction", dir); const r = await fetch(`${APP}/api/v1/cfdi/bulk`, { method: "POST", headers: { cookie: axel.cookie() }, body: f }); return { status: r.status, body: await r.json().catch(() => null) }; };
  r = await bulk([["lote.zip", zipBytes, "application/zip"], ["suelto.xml", cfdiXml(b3, "50.00", "58.00", { rfcE: "AAA010101AAA", rfcR: "EKU9003173C9" }), "text/xml"]], "RECEIVED");
  check("carga masiva: 3 comprobantes cargados, 1 con error y 1 ignorado", r.status === 200 && r.body.summary.created === 3 && r.body.summary.errors === 1 && r.body.summary.ignored === 1, JSON.stringify(r.body?.summary));
  created.cfdi.push(...(await axel.call("/cfdi?direction=RECEIVED&q=AAA010101AAA")).body.data.map((d) => d.id));
  check("el PDF del mismo nombre se guarda junto al XML", ((await axel.call("/cfdi?direction=RECEIVED&q=" + b1)).body?.data?.[0]?.has_pdf) === true);
  r = await bulk([["otra-vez.xml", cfdiXml(b3, "50.00", "58.00", { rfcE: "AAA010101AAA", rfcR: "EKU9003173C9" }), "text/xml"]], "RECEIVED");
  check("repetir un comprobante se reporta como «ya existía»", r.body?.summary?.duplicates === 1 && r.body?.summary?.created === 0);
  const ids3 = ((await axel.call("/cfdi?direction=RECEIVED&q=AAA010101AAA")).body?.data ?? []).filter((d) => Number(d.allocated_minor) === 0).map((d) => d.id);
  r = await axel.call("/cfdi/expenses", "POST", { cfdi_ids: ids3.slice(0, 3), category: "Insumos" });
  check("crea un gasto por cada factura recibida, ligado y por el importe total", r.status === 200 && r.body.summary.created === Math.min(3, ids3.length), JSON.stringify(r.body?.summary));
  for (const x of r.body?.results ?? []) if (x.expense_id) created.expenses.push(x.expense_id);
  const firstExp = (await axel.call(`/expenses/${r.body.results.find((x) => x.expense_id).expense_id}`)).body;
  check("el gasto nace facturado, pendiente de pago, con monto y emisor del CFDI", firstExp.invoicing_status === "INVOICED" && firstExp.payment_status === "PENDING" && !!firstExp.supplier_name && firstExp.category === "Insumos");
  r = await axel.call("/cfdi/expenses", "POST", { cfdi_ids: ids3.slice(0, 3) });
  check("repetir no duplica gastos", r.body?.summary?.created === 0 && r.body?.summary?.skipped === Math.min(3, ids3.length));
  check("un CFDI emitido no origina un gasto", (await axel.call("/cfdi/expenses", "POST", { cfdi_ids: [A.id] })).body?.summary?.errors === 1);
  check("solo con permiso: un solicitante no carga en masa (403)", (await luis.call("/cfdi/expenses", "POST", { cfdi_ids: ids3.slice(0, 1) })).status === 403);

  console.log("Resumen financiero");
  r = await axel.call("/finance/summary?from=2026-10-01&to=2026-10-31");
  const mx = r.body?.by_currency?.MXN;
  check("responde por moneda con ventas, facturación, cobros, gastos y pendientes", r.status === 200 && !!mx && ["sales_registered", "invoicing_issued", "collections_received", "expenses_registered", "payments_made", "receivable", "payable", "sales_without_cfdi", "differences"].every((k) => k in mx));
  check("el resumen incluye el aviso de que no es contabilidad definitiva", /No es utilidad fiscal/.test(r.body?.notice ?? ""));
  check("rango inválido se rechaza", (await axel.call("/finance/summary?from=2026-10-31&to=2026-10-01")).status === 400);

  console.log("Aislamiento entre empresas");
  check("otra organización no ve la venta (404)", (await ricardo.call(`/sales/${sale.id}`)).status === 404);
  check("otra organización no la lista", ((await ricardo.call("/sales")).body?.data ?? []).every((s) => s.id !== sale.id));
  check("otra organización no ve el CFDI (404)", (await ricardo.call(`/cfdi/${A.id}`)).status === 404);
  check("otra organización no puede ligar ese CFDI a su venta", (await ricardo.call("/sales", "POST", { sold_at: "2026-10-06", description: "ajena", lines: [{ description: "x", quantity: 1, unit_price_minor: 100 }] }).then(async (s) => { if (s.body?.id) created.sales.push(s.body.id); return s.body?.id ? (await ricardo.call(`/sales/${s.body.id}/cfdi`, "POST", { cfdi_id: A.id })).status : 0; })) === 400);
  check("otra organización no puede cobrar la venta", (await ricardo.call(`/sales/${sale.id}/payments`, "POST", { paid_at: "2026-10-06", amount_minor: 100 })).status === 404);
  check("el resumen de otra organización no mezcla datos", !JSON.stringify((await ricardo.call("/finance/summary?from=2026-10-01&to=2026-10-31")).body?.by_currency ?? {}).includes(tag));

  console.log("Permisos");
  check("un solicitante no lista ventas (403)", (await luis.call("/sales")).status === 403);
  check("un solicitante no crea ventas (403)", (await luis.call("/sales", "POST", body)).status === 403);
  check("un solicitante no ve el resumen (403)", (await luis.call("/finance/summary")).status === 403);
  check("un solicitante no sube CFDI (403)", (await upload(luis, cfdiXml(U(), "1.00", "1.16"), "ISSUED")).status === 403);

  console.log("Proveedor fiscal: sin simulaciones");
  r = await axel.call("/fiscal/provider");
  check("declara solo lo implementado (emitir y descarga masiva); vigencia y PDF siguen apagados", r.status === 200 && r.body.capabilities.issue === true && r.body.capabilities.fetchReceived === true && !r.body.capabilities.statusLookup && !r.body.capabilities.downloadPdf);
  const sy = await axel.call("/fiscal/sync", "POST", {});
  check("la sincronización sin emisor configurado se rechaza con motivo, no finge (409)", sy.status === 409 && /emisor|reglas|configura/i.test(sy.body?.detail ?? ""), JSON.stringify(sy.body)?.slice(0, 160));
} catch (e) {
  fail++; failures.push("excepción: " + e.message); console.error(e);
} finally {
  // Limpieza de todo lo creado por la prueba (organización de demostración).
  const c = await db();
  try {
    await c.query("begin"); await c.query("set local session_replication_role = replica");
    const sales = created.sales.filter(Boolean);
    const exps = [...new Set([...created.expenses.filter(Boolean), ...(await c.query("select id from expenses where organization_id = $1 and external_reference like 'CFDI:%' and created_at > now() - interval '1 hour'", [meridian])).rows.map((x) => x.id)])];
    const docs = (await c.query("select id, xml_storage_key from cfdi_documents where organization_id = any($1) and (id = any($2) or source = 'MANUAL_UPLOAD' and created_at > now() - interval '1 hour')", [[meridian, golfo], created.cfdi.filter(Boolean)])).rows;
    const invs = created.invoices.filter(Boolean);
    const invRows = (await c.query("select id, xml_storage_key, pdf_storage_key from supplier_invoices where id = any($1)", [invs])).rows;
    await c.query("update supplier_invoices set buyer_cfdi_id = null, supplier_cfdi_id = null where id = any($1)", [invs]);
    const ids = [...sales, ...exps, ...docs.map((d) => d.id), ...invs];
    await c.query("delete from payments where sale_id = any($1) or expense_id = any($2)", [sales, exps]);
    await c.query("delete from cfdi_links where sale_id = any($1) or expense_id = any($2) or cfdi_id = any($3)", [sales, exps, docs.map((d) => d.id)]);
    await c.query("delete from sale_lines where sale_id = any($1)", [sales]);
    await c.query("delete from sales where id = any($1)", [sales]); await c.query("delete from expenses where id = any($1)", [exps]);
    await c.query("delete from cfdi_documents where id = any($1)", [docs.map((d) => d.id)]);
    await c.query("delete from supplier_invoices where id = any($1)", [invs]);
    await c.query("delete from audit_logs where resource_id = any($1) or (action like 'invoice.%' and metadata->>'invoice_id' = any($2))", [ids, invs]);
    await c.query("delete from domain_events where type like 'invoice.%' and aggregate_id in (select order_id from (select unnest($1::uuid[]) as order_id) x) and occurred_at > now() - interval '1 hour'", [[]]);
    await c.query("commit");
    const keys = [...docs.map((d) => d.xml_storage_key), ...invRows.flatMap((i) => [i.xml_storage_key, i.pdf_storage_key])].filter(Boolean);
    if (keys.length) await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from("attachments").remove(keys);
    console.log("Datos de prueba retirados.");
  } catch (e) { await c.query("rollback").catch(() => {}); console.error("No se pudo limpiar:", e.message); fail++; } finally { await c.end(); }
  console.log(`\n${pass} correctas, ${fail} fallidas${failures.length ? ": " + failures.join(" | ") : ""}`);
  process.exit(fail ? 1 : 0);
}
