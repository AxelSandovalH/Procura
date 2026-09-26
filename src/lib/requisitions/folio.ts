import type { Tx } from "@/lib/db/client";

export async function nextFolio(tx: Tx, organizationId: string): Promise<string> {
  const settings = await tx.organization_settings.findUnique({ where: { organization_id: organizationId } });
  const prefix = settings?.requisition_folio_prefix ?? "REQ-";
  const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`select app.next_sequence(${organizationId}::uuid, 'requisition') as value`;
  return `${prefix}${value.toString().padStart(5, "0")}`;
}
