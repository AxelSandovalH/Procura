import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { route, json, Problem } from "@/lib/http/problem";
import { withContext } from "@/lib/db/client";
import { findAutoinvoice, suggestedPaymentForm, totalToMinor, verifyCaptcha } from "@/lib/portal/autoinvoice";

const Body = z.object({ folio: z.string().trim().min(1).max(40), total: z.string().trim().min(1).max(20), captcha_token: z.string().max(4000).optional() });
const NOT_FOUND = "No encontramos un ticket con ese folio y total. Revisa que estén tal como aparecen en tu ticket.";

/** Busca el ticket por folio Y total exactos y devuelve un resumen. Cualquier diferencia responde lo mismo, para que no se pueda adivinar folios. */
export const POST = route(async (req, params) => {
  const ip = clientIp(req);
  await rateLimit("autoinvoice-lookup-ip", ip, { windowSeconds: 600, max: 20 });
  const body = await json(req, (d) => Body.parse(d));
  const info = await findAutoinvoice(params.slug);
  await rateLimit("autoinvoice-lookup-org", info.organization_id, { windowSeconds: 3600, max: 600 });
  await verifyCaptcha(body.captcha_token, ip);
  const minor = totalToMinor(body.total);
  if (minor === null) throw Problem.badRequest("Escribe el total de tu ticket, por ejemplo 245.50.");
  const out = await withContext({ organizationId: info.organization_id }, async (tx) => {
    const sale = await tx.sales.findFirst({ where: { organization_id: info.organization_id, folio: { equals: body.folio, mode: "insensitive" }, total_minor: BigInt(minor), voided_at: null } });
    if (!sale) throw Problem.notFound(NOT_FOUND);
    const live = await tx.fiscal_issue_requests.findFirst({ where: { sale_id: sale.id, status: { in: ["PENDING", "DONE"] } }, select: { status: true } });
    if (live || sale.documented_minor > BigInt(0)) throw Problem.conflict("Este ticket ya fue facturado. Si necesitas tu factura, pídela directamente al establecimiento.");
    const days = Math.floor((Date.now() - sale.sold_at.getTime()) / 86_400_000);
    if (days > info.window_days) throw Problem.conflict(`Ya pasó el plazo para facturar este ticket (${info.window_days} días). Acude al establecimiento.`);
    const lines = await tx.sale_lines.findMany({ where: { sale_id: sale.id }, orderBy: { line_number: "asc" }, select: { description: true, quantity: true, total_minor: true } });
    return { folio: sale.folio, sold_at: sale.sold_at.toISOString().slice(0, 10), currency: sale.currency, total_minor: Number(sale.total_minor), payment_form_code: suggestedPaymentForm(sale.payment_method, info.default_payment_form),
      lines: lines.slice(0, 30).map((l) => ({ description: l.description, quantity: Number(l.quantity), total_minor: Number(l.total_minor) })) };
  });
  return NextResponse.json(out);
});
