// Importación de ventas desde el CSV de un punto de venta: vista previa, creación con el folio del ticket, cobro, idempotencia, conflictos y permisos.
// Escribe y limpia datos en Meridian Yachts. Exige PROCURA_TEST_CONFIRM=yes.
import { randomUUID } from "node:crypto";
import { Client, db, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(meridian);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
const tag = `P${Date.now().toString().slice(-7)}`; const imp = (who, csv, o = {}) => who.call("/sales/import", "POST", { csv, ...o });
const sale = async (folio) => (await axel.call(`/sales?q=${encodeURIComponent(folio)}`)).body.data.find((s) => s.folio === folio);
const csv = `Folio,Fecha,Total,Forma de pago,Estatus,Producto\n${tag}-1,12/10/2026,"1,160.00",Tarjeta de crédito,Pagada,Cena\n${tag}-2,12/10/2026,245.50,Efectivo,Pagada,Café\n${tag}-3,13/10/2026,99.99,Transferencia,Pagada,\n${tag}-4,13/10/2026,500.00,Efectivo,Cancelada,\n${tag}-5,13/10/2026,-80.00,Efectivo,Pagada,\n`;
try {
  let r = await imp(axel, csv, { dry_run: true, tax_percent: 16 });
  check("vista previa: 3 ventas nuevas; omite la cancelada y la devolución", r.status === 200 && r.body.rows === 3 && r.body.new === 3 && r.body.skipped.canceled === 1 && r.body.skipped.refunds === 1, JSON.stringify(r.body));
  check("la vista previa no escribe nada", !(await sale(`${tag}-1`)));
  r = await imp(axel, csv, { tax_percent: 16, mark_collected: true }); check("importa 3 ventas por $1,505.49", r.status === 200 && r.body.created === 3 && r.body.total_minor === 150549 && r.body.ids?.length === 3, JSON.stringify(r.body));
  const s1 = await sale(`${tag}-1`), s2 = await sale(`${tag}-2`), s3 = await sale(`${tag}-3`);
  check("la venta conserva el folio del ticket y su total exacto", s1 && Number(s1.total_minor) === 116000 && Number(s2.total_minor) === 24550 && Number(s3.total_minor) === 9999, JSON.stringify([s1?.folio, s1?.total_minor]));
  check("subtotal + IVA suma exactamente el total del ticket (en los tres)", [s1, s2, s3].every((s) => Number(s.subtotal_minor) + Number(s.tax_minor) === Number(s.total_minor)));
  check("quedan cobradas el día de la venta", [s1, s2, s3].every((s) => s.collection_status === "COLLECTED" && Number(s.collected_minor) === Number(s.total_minor)) && s1.sold_at.startsWith("2026-10-12"));
  const det = (await axel.call(`/sales/${s1.id}`)).body; check("el cobro lleva la forma de pago del ticket", det.payments.length === 1 && det.payments[0].method === "CARD" && Number(det.payments[0].amount_minor) === 116000, JSON.stringify(det.payments));
  r = await imp(axel, csv, { tax_percent: 16 }); check("reimportar el mismo archivo no duplica nada", r.body.created === 0 && r.body.duplicates === 3, JSON.stringify(r.body));
  r = await imp(axel, csv, { dry_run: true }); check("la vista previa avisa que ya estaban", r.body.new === 0 && r.body.duplicates === 3);

  // folio ya usado por otra venta (capturada a mano)
  const manual = (await axel.call("/sales", "POST", { sold_at: "2026-10-12", description: `Manual ${tag}`, lines: [{ description: "x", quantity: 1, unit_price_minor: 1000 }] }, { "idempotency-key": randomUUID() })).body;
  r = await imp(axel, `Folio,Fecha,Total\n${manual.folio},12/10/2026,50.00\n${tag}-6,12/10/2026,60.00\n`, { tax_percent: 0 });
  check("un folio que ya usa otra venta se informa y no se crea", r.body.created === 1 && r.body.folio_conflicts.includes(manual.folio), JSON.stringify(r.body));
  const s6 = await sale(`${tag}-6`); check("sin IVA: subtotal igual al total", Number(s6.subtotal_minor) === 6000 && Number(s6.tax_minor) === 0);

  // corte diario sin folio
  const daily = `Fecha;Importe\n11/10/2026;5,320.00\n11/10/2026;5,320.00\n`;
  r = await imp(axel, daily, { tax_percent: 16, mark_collected: false }); check("corte diario sin folio: dos ventas iguales no se funden y reciben folio de ProcuraOS", r.body.created === 2 && r.status === 200, JSON.stringify(r.body));
  const dailySales = (await axel.call("/sales?from=2026-10-11&to=2026-10-11")).body.data.filter((s) => Number(s.total_minor) === 532000 && /Importada/.test(s.notes ?? ""));
  check("sin «marcar como cobradas» quedan pendientes de cobro", dailySales.length >= 2 && dailySales.every((s) => s.collection_status === "PENDING"), JSON.stringify(dailySales.map((s) => s.collection_status)));
  r = await imp(axel, daily, { tax_percent: 16 }); check("reimportar el corte tampoco duplica", r.body.created === 0 && r.body.duplicates === 2, JSON.stringify(r.body));

  check("sin encabezado válido: 400", (await imp(axel, "a,b\n1,2\n3,4 y más relleno")).status === 400);
  const big = "Folio,Fecha,Total\n" + Array.from({ length: 1001 }, (_, i) => `B${i},12/10/2026,10.00`).join("\n"); check("más de 1,000 ventas por archivo: 400", (await imp(axel, big, { dry_run: true })).status === 400);
  check("quien no gestiona ventas no importa (403)", (await imp(luis, csv)).status === 403);
  const d = await db(); const log = await d.query("select count(*)::int as n from audit_logs where organization_id=$1 and action='sales.imported'", [meridian]); await d.end(); check("la importación queda en la bitácora", log.rows[0].n >= 3, String(log.rows[0].n));
} finally {
  const d = await db();
  try {
    const ids = (await d.query("select id from sales where organization_id=$1 and (folio like $2 or notes like 'Importada%' or description like $3 or description like 'Ventas del %')", [meridian, `${tag}%`, `Manual ${tag}%`])).rows.map((x) => x.id);
    await d.query("delete from payments where sale_id = any($1)", [ids]); await d.query("delete from sale_lines where sale_id = any($1)", [ids]); await d.query("delete from sales where id = any($1)", [ids]);
    await d.query("delete from audit_logs where organization_id=$1 and action in ('sales.imported')", [meridian]);
  } catch (e) { console.log("limpieza:", e.message); } finally { await d.end(); }
}
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
