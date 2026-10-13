import { NextResponse } from "next/server";
import { route, json } from "@/lib/http/problem";
import { requireActor } from "@/lib/auth/context";
import { authorize } from "@/lib/auth/policy";
import { auditBase } from "@/lib/audit";
import { IssueBody, issueSaleCfdi } from "@/lib/billing/issue-sale";

/** Emite el CFDI de ingreso de una venta con el proveedor fiscal y lo liga a ella. Solo la venta completa; un solo timbrado por venta. */
export const POST = route(async (req, params) => {
  const actor = await requireActor(req);
  authorize(actor, "sale.manage"); authorize(actor, "cfdi.manage");
  const body = await json(req, (d) => IssueBody.parse(d));
  const out = await issueSaleCfdi({ organizationId: actor.organizationId, userId: actor.userId, membershipId: actor.membershipId, saleId: params.id, body, auditBase: auditBase(actor) });
  return NextResponse.json(out.sale, { status: 201 });
});
