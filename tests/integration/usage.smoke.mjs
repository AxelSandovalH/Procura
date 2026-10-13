// Consumo de servicios con costo variable (emisión, recuperación del SAT y OCR) por organización. Solo lectura. Exige PROCURA_TEST_CONFIRM=yes.
import { Client, orgId } from "./client.mjs";
if (process.env.PROCURA_TEST_CONFIRM !== "yes") { console.error("Define PROCURA_TEST_CONFIRM=yes."); process.exit(2); }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ✔", n); } else { fail++; console.log("  ✘", n, x); } };
const axelOrg = await orgId("Axel Sandoval"), meridian = await orgId("Meridian Yachts");
const axel = await new Client("axel").loginMagic("axesan917+procura@gmail.com"); await axel.useOrg(axelOrg);
const luis = await new Client("luis").loginMagic("luis.herrera@meridian-demo.example.com"); await luis.useOrg(meridian);
let r = await axel.call("/organization/fiscal-usage?month=2026-10");
check("devuelve el consumo del mes", r.status === 200 && r.body.month === "2026-10" && r.body.rfc === "SAHA040711DH6", JSON.stringify(r.body));
check("separa emisión, recuperación del SAT y OCR", r.body.emission && r.body.sat_recovery && r.body.ocr && typeof r.body.emission.stamped === "number" && typeof r.body.sat_recovery.cfdi_new === "number", JSON.stringify(r.body));
check("la recuperación refleja lo importado (al menos 3 CFDI nuevos del SAT en octubre)", r.body.sat_recovery.cfdi_new >= 3, JSON.stringify(r.body.sat_recovery));
check("emisión y recuperación no se mezclan (no hay timbrados desde Procura aún)", r.body.emission.stamped === 0, JSON.stringify(r.body.emission));
check("mes inválido: 400", (await axel.call("/organization/fiscal-usage?month=2026-13")).status === 400);
check("un mes sin movimientos da ceros", (await axel.call("/organization/fiscal-usage?month=2025-01")).body.sat_recovery.cfdi_new === 0);
check("quien no administra la organización no lo ve (403)", (await luis.call("/organization/fiscal-usage")).status === 403);
console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
