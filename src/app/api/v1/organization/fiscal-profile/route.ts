import { NextResponse } from "next/server";
import { z } from "zod";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { withContext } from "@/lib/db/client";
import { audit, auditBase } from "@/lib/audit";

const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const Body = z.object({
  tax_regime_code: z.string().regex(/^\d{3}$/, "El régimen fiscal son 3 dígitos (601, 612, 626…)").nullable().optional(),
  zip_code: z.string().regex(/^\d{5}$/, "El código postal son 5 dígitos").nullable().optional(),
  cfdi_use_code: z.string().regex(/^[A-Z]\d{2}$/, "El uso de CFDI es una letra y dos dígitos (G03, G01, S01…)").optional(),
  street: opt(120), exterior_number: opt(20), interior_number: opt(20), neighborhood: opt(120), municipality: opt(120), state: opt(80),
  invoice_email: z.string().trim().email().max(200).nullable().optional(),
});

/** Datos para pedir facturas a los proveedores: razón social y RFC (de la organización) más régimen, domicilio fiscal, uso de CFDI y correo. */
export const GET = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.read");
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const [org, profile] = await Promise.all([
      tx.organizations.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { legal_name: true, display_name: true, tax_id: true } }),
      tx.organization_fiscal_profiles.findUnique({ where: { organization_id: actor.organizationId } }),
    ]);
    return { legal_name: org.legal_name, display_name: org.display_name, tax_id: org.tax_id, profile: profile ?? { tax_regime_code: null, zip_code: null, cfdi_use_code: "G03", street: null, exterior_number: null, interior_number: null, neighborhood: null, municipality: null, state: null, invoice_email: null } };
  });
  return NextResponse.json(out);
});

export const PUT = route(async (req) => {
  const actor = await requireActor(req);
  authorize(actor, "organization.update");
  const body = await json(req, (d) => Body.parse(d));
  const out = await withContext({ userId: actor.userId, organizationId: actor.organizationId }, async (tx) => {
    const row = await tx.organization_fiscal_profiles.upsert({ where: { organization_id: actor.organizationId }, create: { organization_id: actor.organizationId, ...body }, update: { ...body, updated_at: new Date() } });
    await audit(tx, { ...auditBase(actor), action: "organization.fiscal_profile_updated", resourceType: "organization", resourceId: actor.organizationId, metadata: { fields: Object.keys(body) } });
    return row;
  });
  return NextResponse.json(out);
});
