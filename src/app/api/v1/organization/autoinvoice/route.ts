import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json, Problem } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";
import { getFiscalProvider } from "@/lib/fiscal/fiscalapi";
import { assertFeature } from "@/lib/billing/entitlements";

const Body = z.object({
  enabled: z.boolean().optional(), window_days: z.number().int().min(1).max(365).optional(), daily_limit: z.number().int().min(1).max(5000).optional(),
  default_payment_form: z.enum(["01", "03", "04", "28"]).optional(), welcome_text: z.string().trim().max(500).nullable().optional(),
});

async function view(tx: Parameters<Parameters<typeof withContext>[1]>[0], organizationId: string) {
  const [org, s, conn] = await Promise.all([
    tx.organizations.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } }),
    tx.autoinvoice_settings.findUnique({ where: { organization_id: organizationId } }),
    tx.fiscal_provider_connections.findUnique({ where: { organization_id_provider: { organization_id: organizationId, provider: getFiscalProvider().name } } }),
  ]);
  const cfg = (conn?.settings ?? {}) as { expedition_zip_code?: string; default_product_code?: string; default_unit_code?: string };
  return { slug: org.slug, enabled: s?.enabled ?? false, window_days: s?.window_days ?? 30, daily_limit: s?.daily_limit ?? 50, default_payment_form: s?.default_payment_form ?? "01", welcome_text: s?.welcome_text ?? null,
    // Lo que falta para que el portal pueda emitir de verdad.
    ready: { issuer: !!conn?.external_account_id && !!cfg.expedition_zip_code, product_codes: !!cfg.default_product_code && !!cfg.default_unit_code, live: getFiscalProvider().environment() === "live" } };
}

export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.read");
  return NextResponse.json(await withContext({ userId: actor.userId, organizationId: actor.organizationId }, (tx) => view(tx, actor.organizationId)));
});

/** Configura el portal público de autofacturación de la organización. Encenderlo exige el emisor fiscal configurado y las claves SAT por omisión. */
export const PUT = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  const body = await json(req, (d) => Body.parse(d));
  if (body.enabled === true) await assertFeature(actor.organizationId, "issuing");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    if (body.enabled === true) {
      const v = await view(tx, actor.organizationId);
      if (!v.ready.issuer) throw Problem.conflict("Antes configura el emisor fiscal (Administración → Organización → Facturación electrónica).");
      if (!v.ready.product_codes) throw Problem.conflict("Antes define la clave de producto/servicio y de unidad SAT por omisión: el cliente no las captura.");
    }
    await tx.autoinvoice_settings.upsert({ where: { organization_id: actor.organizationId }, create: { organization_id: actor.organizationId, ...body }, update: { ...body, updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "organization.autoinvoice_updated", resourceType: "organization", resourceId: actor.organizationId, metadata: body });
    return view(tx, actor.organizationId);
  });
  return NextResponse.json(out);
});
