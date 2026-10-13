import { NextResponse } from "next/server";
import { route, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { signedCfdiUrls } from "@/lib/billing/cfdi-docs";
import { generateAndStorePdf } from "@/lib/billing/cfdi-pdf";

/** PDF de un CFDI emitido desde Procura: se genera con el proveedor la primera vez y se guarda; después solo se entrega el enlace firmado. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const ctx = { userId: actor.userId, organizationId: actor.organizationId };
  const d = await withContext(ctx, (tx) => tx.cfdi_documents.findFirst({ where: { id: params.id, organization_id: actor.organizationId } }));
  if (!d) throw Problem.notFound();
  let generated = false;
  if (!d.pdf_storage_key) {
    await generateAndStorePdf(actor.organizationId, d.id); generated = true;
    await withContext(ctx, (tx) => audit(tx, { ...auditBase(actor), action: "cfdi.pdf_generated", resourceType: "cfdi", resourceId: d.id, resourceLabel: d.fiscal_uuid }));
  }
  const fresh = await withContext(ctx, (tx) => tx.cfdi_documents.findFirstOrThrow({ where: { id: d.id } }));
  const urls = await signedCfdiUrls(fresh);
  return NextResponse.json({ generated, pdf_url: urls.pdf_url });
});
