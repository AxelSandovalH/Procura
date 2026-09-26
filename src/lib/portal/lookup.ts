import { withContext } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

export interface PortalInfo { organization_id: string; slug: string; display_name: string; welcome_text: string | null }

/** Portal público por slug. 404 si no existe O si el portal no está habilitado (no revela cuál de las dos). */
export async function findPortal(slug: string): Promise<PortalInfo> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(slug)) throw Problem.notFound("Portal no encontrado");
  const [row] = await withContext({}, (tx) => tx.$queryRaw<PortalInfo[]>`select * from app.portal_public_info(${slug})`);
  if (!row) throw Problem.notFound("Portal no encontrado");
  return row;
}
