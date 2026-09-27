export interface EmailNotification {
  type: string; title: string; body: string | null; org_name: string; full_name: string;
  resource_type: string | null; resource_id: string | null; anchor_type: string | null; anchor_id: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Ruta de la app a la que lleva el aviso. Recursos sin pantalla propia caen en /inicio. */
export function notificationPath(n: Pick<EmailNotification, "resource_type" | "resource_id" | "anchor_type" | "anchor_id">): string {
  const id = n.resource_id;
  switch (n.resource_type) {
    case "requisition": return id ? `/requisiciones/${id}` : "/requisiciones";
    case "quotation_request": return id ? `/solicitudes/${id}` : "/solicitudes";
    case "quotation": return id ? `/cotizaciones/${id}` : "/solicitudes";
    case "order": return id ? `/ordenes/${id}` : "/ordenes";
    case "relationship": return id ? `/relaciones/${id}` : "/relaciones";
    case "thread": {
      const a = n.anchor_id;
      if (n.anchor_type === "ORDER" && a) return `/ordenes/${a}`;
      if (n.anchor_type === "RFQ" && a) return `/solicitudes/${a}`;
      if (n.anchor_type === "QUOTATION" && a) return `/cotizaciones/${a}`;
      return "/inicio";
    }
    default: return "/inicio";
  }
}

export function renderNotificationEmail(n: EmailNotification, appUrl: string): { subject: string; html: string; text: string } {
  const base = appUrl.replace(/\/$/, "");
  const link = `${base}${notificationPath(n)}`;
  const settings = `${base}/cuenta`;
  const first = n.full_name.split(" ")[0] || "";
  const subject = n.title;
  const text = [
    first ? `Hola ${first},` : "Hola,", "", n.title, n.body ?? "", `Ábrelo en Procura: ${link}`, "",
    `Recibes este aviso por tu actividad en ${n.org_name}. Puedes desactivar los correos en ${settings}`,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:600;letter-spacing:-0.01em">Procura</td></tr>
<tr><td style="padding-top:20px;font-size:13px;color:#525252">${first ? `Hola ${esc(first)},` : "Hola,"}</td></tr>
<tr><td style="padding-top:8px;font-size:18px;font-weight:600;line-height:1.35">${esc(n.title)}</td></tr>
${n.body ? `<tr><td style="padding-top:8px;font-size:14px;line-height:1.5;color:#404040">${esc(n.body)}</td></tr>` : ""}
<tr><td style="padding-top:22px"><a href="${esc(link)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px">Abrir en Procura</a></td></tr>
<tr><td style="padding-top:26px;font-size:12px;line-height:1.5;color:#737373">Recibes este aviso por tu actividad en ${esc(n.org_name)}. <a href="${esc(settings)}" style="color:#737373">Desactivar correos</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
