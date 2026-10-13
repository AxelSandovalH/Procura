// Ejecuta la sincronización de la descarga masiva del SAT para una organización (como el cron). Uso: FISCALAPI_URL=https://live.fiscalapi.com tsx --env-file=.env.local tests/integration/run-sync.ts <organizationId>
import { runDownloadSync } from "@/lib/fiscal/download";
async function main() { console.log(await runDownloadSync(process.argv[2]!, null)); process.exit(0); }
main().catch((e) => { console.error(e); process.exit(1); });
