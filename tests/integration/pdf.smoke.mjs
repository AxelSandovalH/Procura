// PDF de CFDI emitidos: permisos, reglas y entrega desde Storage. No llama al proveedor con datos reales (id ficticio → falla y se mapea a 502). Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client, db, orgId, APP, env } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const xml = (u) => `<?xml version="1.0" encoding="utf-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="P" Folio="${u.slice(0, 4)}" Fecha="2026-10-05T12:00:00" SubTotal="100.00" Total="116.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03"><cfdi:Emisor Rfc="EKU9003173C9" Nombre="Meridian"/><cfdi:Receptor Rfc="XAXX010101000" Nombre="Cliente"/><cfdi:Impuestos TotalImpuestosTrasladados="16.00"/><cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${u}"/></cfdi:Complemento></cfdi:Comprobante>`;
const up = async (u) => { const f = new FormData(); f.append("xml", new Blob([xml(u)], { type: "text/xml" }), "c.xml"); f.append("direction", "ISSUED"); const r = await fetch(`${APP}/api/v1/cfdi`, { method: "POST", headers: { cookie: axel.cookie() }, body: f }); return (await r.json()).id; };
const u1 = randomUUID().toUpperCase(), u2 = randomUUID().toUpperCase(); const ids = []; const key = `${meridian}/cfdi/${u2}.pdf`;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const a = await up(u1), b = await up(u2); ids.push(a, b);
  check("solicitante no genera PDF", (await luis.call(`/cfdi/${a}/pdf`, "POST", {})).status === 403);
  check("un CFDI que no se emitió desde Procura: 409", (await axel.call(`/cfdi/${a}/pdf`, "POST", {})).status === 409);
  const d = await db(); await d.query("update cfdi_documents set provider='fiscalapi', provider_external_id=$2 where id=$1", [a, randomUUID()]); await d.end();
  const r = await axel.call(`/cfdi/${a}/pdf`, "POST", {}); check("si el proveedor falla: 502 y no queda PDF", r.status === 502 && !(await axel.call(`/cfdi/${a}`)).body.has_pdf, JSON.stringify(r.body));
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"); const upl = await sb.storage.from("attachments").upload(key, pdf, { contentType: "application/pdf", upsert: true }); check("(prep) sube un PDF de prueba a Storage", !upl.error, upl.error?.message);
  const d2 = await db(); await d2.query("update cfdi_documents set pdf_storage_key=$2, pdf_filename=$3 where id=$1", [b, key, `${u2}.pdf`]); await d2.end();
  const ok = await axel.call(`/cfdi/${b}/pdf`, "POST", {}); check("con PDF guardado: lo entrega sin llamar al proveedor", ok.status === 200 && ok.body.generated === false && /^https:\/\//.test(ok.body.pdf_url ?? ""), JSON.stringify(ok.body));
  const det = await axel.call(`/cfdi/${b}`); check("el detalle expone el enlace del PDF", !!det.body.downloads.pdf_url && det.body.has_pdf === true);
} finally {
  const d = await db();
  try { await d.query("delete from cfdi_links where cfdi_id = any($1)", [ids]); await d.query("delete from cfdi_documents where id = any($1)", [ids]); await d.query("delete from audit_logs where resource_label = any($1)", [[u1, u2]]); } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
  await sb.storage.from("attachments").remove([key]).catch(() => {});
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
