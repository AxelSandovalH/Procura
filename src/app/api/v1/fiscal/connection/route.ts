import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { FiscalProviderError } from "@/lib/fiscal/provider";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";

const Body = z.object({
  issuer_id: z.string().trim().min(1).max(80),
  expedition_zip_code: z.string().regex(/^\d{5}$/, "El código postal de expedición son 5 dígitos"),
  series: z.string().regex(/^[A-Za-z0-9]{1,25}$/, "La serie son de 1 a 25 caracteres alfanuméricos").default("A"),
  default_product_code: z.string().regex(/^\d{8}$/, "La clave de producto SAT son 8 dígitos").optional(),
  default_unit_code: z.string().regex(/^[A-Z0-9]{2,3}$/, "La clave de unidad SAT son 2 o 3 caracteres (E48, H87…)").optional(),
  time_zone: z.string().max(60).default("America/Mazatlan"),
});

/** Guarda con qué emisor y con qué valores por omisión emite esta organización. El emisor debe existir en el proveedor. */
export const PUT = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "cfdi.manage");
  const body = await json(req, (d) => Body.parse(d));
  const p = getFiscalProvider();
  let issuer;
  try { issuer = (await p.listIssuers()).find((i) => i.id === body.issuer_id); }
  catch (e) { if (e instanceof FiscalProviderError) throw new Problem(e.code === "NOT_CONFIGURED" ? 409 : 502, "Proveedor fiscal", e.message, { code: e.code }); throw e; }
  if (!issuer) throw Problem.badRequest("Ese emisor no existe en tu cuenta del proveedor fiscal.");
  const { issuer_id, ...settings } = body;
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const row = await tx.fiscal_provider_connections.upsert({
      where: { organization_id_provider: { organization_id: actor.organizationId, provider: p.name } },
      create: { organization_id: actor.organizationId, provider: p.name, external_account_id: issuer_id, settings: { ...settings, issuer_name: issuer.legalName, issuer_tax_id: issuer.taxId } },
      update: { external_account_id: issuer_id, settings: { ...settings, issuer_name: issuer.legalName, issuer_tax_id: issuer.taxId }, updated_at: new Date() },
    });
    await audit(tx, { ...auditBase(actor), action: "fiscal.connection_configured", resourceType: "organization", resourceId: actor.organizationId, metadata: { provider: p.name, issuer_id, issuer_tax_id: issuer.taxId } });
    return row;
  });
  return NextResponse.json({ provider: p.name, external_account_id: out.external_account_id, settings: out.settings });
});
