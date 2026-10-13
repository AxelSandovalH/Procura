"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { money } from "@/lib/format";

interface Customer { id: string; name: string; tax_id: string | null; tax_regime_code: string | null; zip_code: string | null; cfdi_use_code: string | null; email: string | null }
export interface IssueSale { id: string; folio: string; currency: string; total_minor: number | string; voided_at: string | null; documented_minor: number | string; customer: Customer | null;
  lines: { id: string; line_number: number; description: string; sat_product_code?: string | null; sat_unit_code?: string | null }[];
  fiscal_issue: { status: string; error: string | null; provider_invoice_id: string | null } | null }
interface Provider { configured: boolean; environment: "test" | "live" | "custom" | null; capabilities: { issue: boolean }; connection: { external_account_id: string | null; settings: { default_product_code?: string; default_unit_code?: string; issuer_name?: string; issuer_tax_id?: string } } | null }

const REGIMES = [["601", "General de Ley Personas Morales"], ["603", "Personas Morales con Fines no Lucrativos"], ["605", "Sueldos y Salarios"], ["606", "Arrendamiento"], ["612", "Personas Físicas con Actividades Empresariales y Profesionales"], ["616", "Sin obligaciones fiscales"], ["621", "Incorporación Fiscal"], ["625", "Plataformas Tecnológicas"], ["626", "Régimen Simplificado de Confianza"]];
const USES = [["G01", "Adquisición de mercancías"], ["G03", "Gastos en general"], ["I01", "Construcciones"], ["I04", "Equipo de cómputo"], ["P01", "Por definir"], ["S01", "Sin efectos fiscales"]];
const FORMS = [["01", "Efectivo"], ["02", "Cheque nominativo"], ["03", "Transferencia electrónica"], ["04", "Tarjeta de crédito"], ["28", "Tarjeta de débito"], ["99", "Por definir"]];
const sel = "h-9 w-full rounded-lg border bg-background px-2 text-sm";

/** Emite el CFDI de ingreso de la venta con el proveedor fiscal. En producción exige confirmar que el timbrado es real. */
export function IssueInvoiceButton({ sale, onDone }: { sale: IssueSale; onDone: () => Promise<unknown> }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const provider = useQuery({ queryKey: ["fiscal-provider"], queryFn: () => api<Provider>("/fiscal/provider"), staleTime: 60_000, enabled: can("cfdi.manage") });
  const p = provider.data;
  const c = sale.customer;
  const [f, setF] = useState({ tax_id: c?.tax_id ?? "", legal_name: c?.name ?? "", regime: c?.tax_regime_code ?? "", zip: c?.zip_code ?? "", use: c?.cfdi_use_code ?? "G03", email: c?.email ?? "", form: "03", method: "PUE", save: !!c, confirm: false });
  const [codes, setCodes] = useState<Record<string, { product: string; unit: string }>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const live = p?.environment === "live";
  const issuing = sale.fiscal_issue?.status === "PENDING";
  const done = sale.fiscal_issue?.status === "DONE" || Number(sale.documented_minor) > 0;
  if (!can("cfdi.manage") || !can("sale.manage") || !p?.configured || !p.capabilities.issue || sale.voided_at || done) {
    return issuing ? <p role="status" className="text-sm text-amber-700">Hay una emisión en curso o sin cerrar para esta venta{sale.fiscal_issue?.error ? `: ${sale.fiscal_issue.error}` : ""}. Revisa el panel del proveedor antes de reintentar.</p> : null;
  }
  const noIssuer = !p.connection?.external_account_id;
  const def = p.connection?.settings ?? {};
  const code = (id: string, k: "product" | "unit", saved?: string | null, fallback?: string) => codes[id]?.[k] ?? saved ?? fallback ?? "";
  const lineOk = sale.lines.every((l) => /^\d{8}$/.test(code(l.id, "product", l.sat_product_code, def.default_product_code)) && /^[A-Z0-9]{2,3}$/.test(code(l.id, "unit", l.sat_unit_code, def.default_unit_code)));
  const valid = f.tax_id.trim().length >= 12 && f.legal_name.trim() && f.regime && /^\d{5}$/.test(f.zip) && f.use && lineOk && (!live || f.confirm);

  async function go() {
    setBusy(true); setError(null);
    try {
      await api(`/sales/${sale.id}/invoice`, { body: {
        payment_form_code: f.form, payment_method_code: f.method, save_recipient: f.save && !!c,
        recipient: { tax_id: f.tax_id.trim().toUpperCase(), legal_name: f.legal_name.trim(), tax_regime_code: f.regime, zip_code: f.zip, cfdi_use_code: f.use, ...(f.email.trim() ? { email: f.email.trim() } : {}) },
        lines: sale.lines.map((l) => ({ line_id: l.id, product_code: code(l.id, "product", l.sat_product_code, def.default_product_code), unit_code: code(l.id, "unit", l.sat_unit_code, def.default_unit_code) })),
      } });
      await onDone(); setOpen(false);
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo emitir la factura."); } finally { setBusy(false); }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={noIssuer} title={noIssuer ? "Configura primero el emisor en Administración → Organización" : undefined}><FileCheck2 />Emitir factura (CFDI)</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Emitir factura de {sale.folio}</DialogTitle><DialogDescription>Total {money(sale.total_minor, sale.currency)} · emisor {def.issuer_name ?? "—"} {def.issuer_tax_id ? `(${def.issuer_tax_id})` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          {live ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400">PRODUCCIÓN: se timbrará un CFDI real ante el SAT. Consume un timbre y tiene valor fiscal. Procura aún no puede cancelarlo; si te equivocas, se cancela desde el panel de Fiscalapi o el portal del SAT.</p>
            : <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">Ambiente de pruebas: la factura no tiene valor fiscal.</p>}
          <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">Receptor (tal como está en su constancia de situación fiscal)</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="i-rfc">RFC *</Label><Input id="i-rfc" maxLength={13} value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value.toUpperCase() })} /></div>
              <div className="space-y-1.5"><Label htmlFor="i-cp">Código postal fiscal *</Label><Input id="i-cp" inputMode="numeric" maxLength={5} value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value })} /></div>
              <div className="col-span-2 space-y-1.5"><Label htmlFor="i-name">Razón social *</Label><Input id="i-name" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /><p className="text-xs text-muted-foreground">Sin «S.A. de C.V.» ni régimen societario, en mayúsculas y exactamente como la constancia.</p></div>
              <div className="space-y-1.5"><Label htmlFor="i-reg">Régimen fiscal *</Label><select id="i-reg" className={sel} value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}><option value="">Elige…</option>{REGIMES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="i-use">Uso de CFDI *</Label><select id="i-use" className={sel} value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })}>{USES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
              <div className="col-span-2 space-y-1.5"><Label htmlFor="i-mail">Correo (opcional)</Label><Input id="i-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            </div>
            {c && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.save} onChange={(e) => setF({ ...f, save: e.target.checked })} />Guardar estos datos fiscales en el cliente «{c.name}»</label>}
          </fieldset>
          <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">Pago</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="i-form">Forma de pago *</Label><select id="i-form" className={sel} value={f.form} onChange={(e) => setF({ ...f, form: e.target.value })}>{FORMS.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="i-met">Método de pago *</Label><select id="i-met" className={sel} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="PUE">PUE · Pago en una sola exhibición</option><option value="PPD">PPD · Pago en parcialidades o diferido</option></select></div>
            </div></fieldset>
          <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Claves SAT por concepto</legend>
            {sale.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_7rem_5rem] items-center gap-2 text-sm">
                <span className="truncate">{l.description}</span>
                <Input aria-label={`Clave de producto de ${l.description}`} inputMode="numeric" maxLength={8} placeholder="8 dígitos" value={code(l.id, "product", l.sat_product_code, def.default_product_code)} onChange={(e) => setCodes({ ...codes, [l.id]: { product: e.target.value, unit: code(l.id, "unit", l.sat_unit_code, def.default_unit_code) } })} />
                <Input aria-label={`Clave de unidad de ${l.description}`} maxLength={3} placeholder="E48" value={code(l.id, "unit", l.sat_unit_code, def.default_unit_code)} onChange={(e) => setCodes({ ...codes, [l.id]: { product: code(l.id, "product", l.sat_product_code, def.default_product_code), unit: e.target.value.toUpperCase() } })} />
              </div>))}
            <p className="text-xs text-muted-foreground">Clave de producto o servicio (8 dígitos) y de unidad (E48, H87…) del catálogo del SAT. Confírmalas con tu contador.</p></fieldset>
          {live && <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} />Entiendo que se timbrará una factura real ante el SAT y que revisé los datos del receptor.</label>}
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button onClick={() => void go()} disabled={busy || !valid}>{busy ? "Timbrando…" : live ? "Timbrar factura real" : "Emitir factura de prueba"}</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}
