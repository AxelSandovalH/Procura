import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/http/rate-limit";
import { route, json, Problem } from "@/lib/http/problem";
import { withContext } from "@/lib/db/client";
import { issueSaleCfdi } from "@/lib/billing/issue-sale";
import { signedCfdiUrls } from "@/lib/billing/cfdi-docs";
import { sendEmailNow } from "@/lib/email/outbox";
import { PORTAL_PAYMENT_FORMS, customerSafeMessage, findAutoinvoice, hashIp, totalToMinor, verifyCaptcha } from "@/lib/portal/autoinvoice";

const Body = z.object({
  folio: z.string().trim().min(1).max(40), total: z.string().trim().min(1).max(20), captcha_token: z.string().max(4000).optional(),
  payment_form_code: z.enum(PORTAL_PAYMENT_FORMS.map(([c]) => c) as [string, ...string[]]),
  recipient: z.object({
    tax_id: z.string().trim().toUpperCase().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "El RFC no tiene el formato correcto"), legal_name: z.string().trim().min(1, "Escribe tu nombre o razón social").max(250),
    tax_regime_code: z.string().regex(/^\d{3}$/, "Elige tu régimen fiscal"), zip_code: z.string().regex(/^\d{5}$/, "El código postal fiscal son 5 dígitos"),
    cfdi_use_code: z.string().regex(/^[A-Z]\d{2}$/, "Elige el uso de CFDI"), email: z.string().trim().email("Escribe un correo válido").max(200),
  }),
  accept: z.literal(true, { message: "Confirma que tus datos son correctos" }),
});
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Emite la factura del ticket con los datos fiscales que el cliente capturó. Mismo camino de emisión que la app (un timbrado por venta), con límites:
 * por IP, plazo después de la venta y tope diario de facturas pedidas por el público. Manda el XML al correo del cliente.
 */
export const POST = route(async (req, params) => {
  const ip = clientIp(req);
  await rateLimit("autoinvoice-issue-ip", ip, { windowSeconds: 3600, max: 12 });
  const body = await json(req, (d) => Body.parse(d));
  const info = await findAutoinvoice(params.slug);
  await verifyCaptcha(body.captcha_token, ip);
  const minor = totalToMinor(body.total);
  if (minor === null) throw Problem.badRequest("Escribe el total de tu ticket, por ejemplo 245.50.");
  const sale = await withContext({ organizationId: info.organization_id }, (tx) => tx.sales.findFirst({ where: { organization_id: info.organization_id, folio: { equals: body.folio, mode: "insensitive" }, total_minor: BigInt(minor), voided_at: null } }));
  if (!sale) throw Problem.notFound("No encontramos un ticket con ese folio y total. Revisa que estén tal como aparecen en tu ticket.");
  let out;
  try {
    out = await issueSaleCfdi({
      organizationId: info.organization_id, userId: null, membershipId: null, saleId: sale.id, source: "PORTAL", requester: { email: body.recipient.email, ipHash: hashIp(ip) },
      auditBase: { actorType: "SYSTEM", actorId: null, membershipId: null, apiKeyId: null, organizationId: info.organization_id },
      body: { payment_form_code: body.payment_form_code, payment_method_code: "PUE", recipient: { tax_id: body.recipient.tax_id, legal_name: body.recipient.legal_name, tax_regime_code: body.recipient.tax_regime_code, zip_code: body.recipient.zip_code, cfdi_use_code: body.recipient.cfdi_use_code, email: body.recipient.email }, save_recipient: false, lines: [] },
      precheck: async (tx, s) => {
        const days = Math.floor((Date.now() - s.sold_at.getTime()) / 86_400_000);
        if (days > info.window_days) throw Problem.conflict(`Ya pasó el plazo para facturar este ticket (${info.window_days} días). Acude al establecimiento.`);
        const today = await tx.fiscal_issue_requests.count({ where: { organization_id: info.organization_id, source: "PORTAL", status: { in: ["PENDING", "DONE"] }, created_at: { gt: new Date(Date.now() - 86_400_000) } } });
        if (today >= info.daily_limit) throw new Problem(429, "Límite diario", "El comercio alcanzó su límite diario de facturas por este medio. Inténtalo mañana o acude al establecimiento.");
      },
    });
  } catch (e) {
    if (e instanceof Problem && (e.status === 502 || e.status === 409 || e.status === 400)) {
      const detail = typeof e.detail === "string" ? e.detail : undefined;
      // Los avisos propios del portal (ya facturado, plazo, datos del cliente) se muestran; los del proveedor y la configuración, no.
      if (e.status === 409 && detail && /ya fue facturada|emisión en curso|Ya pasó el plazo/.test(detail)) throw e;
      throw new Problem(e.status === 502 || e.status === 409 ? 503 : e.status, e.status === 400 ? e.title : "No se pudo facturar", customerSafeMessage(detail));
    }
    throw e;
  }
  const urls = await signedCfdiUrls({ xml_storage_key: out.cfdi.xml_key, xml_filename: `${out.cfdi.fiscal_uuid}.xml`, pdf_storage_key: out.pdf?.key ?? null, pdf_filename: out.pdf?.filename ?? null }, 900);
  const emailed = await sendEmailNow(body.recipient.email, {
    subject: `Tu factura de ${info.display_name} (folio ${sale.folio})`,
    html: `<p>Hola,</p><p>Adjuntamos el PDF y el XML de tu factura (CFDI) de <b>${esc(info.display_name)}</b> por el ticket <b>${esc(sale.folio)}</b>.</p><p>Folio fiscal: <code>${out.cfdi.fiscal_uuid}</code></p><p>Guarda ambos archivos: el XML es tu comprobante fiscal.</p>`,
    text: `Adjuntamos el XML de tu factura de ${info.display_name} por el ticket ${sale.folio}. Folio fiscal: ${out.cfdi.fiscal_uuid}.`,
    attachments: [...(out.pdf ? [{ filename: out.pdf.filename, content: out.pdf.buffer }] : []), { filename: `${out.cfdi.fiscal_uuid}.xml`, content: out.cfdi.xml }],
  });
  return NextResponse.json({ folio: sale.folio, fiscal_uuid: out.cfdi.fiscal_uuid, xml_url: urls.xml_url, pdf_url: urls.pdf_url, emailed }, { status: 201 });
});
