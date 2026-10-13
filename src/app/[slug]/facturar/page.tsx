"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Receipt } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { money } from "@/lib/format";
import { SAT_REGIMES, SAT_USES } from "@/lib/ui/sat-catalogs";

interface Info { portal: { slug: string; display_name: string; welcome_text: string | null; window_days: number }; captcha_site_key: string | null }
interface Found { folio: string; sold_at: string; currency: string; total_minor: number; payment_form_code: string; lines: { description: string; quantity: number; total_minor: number }[] }
interface Done { folio: string; fiscal_uuid: string; xml_url: string | null; pdf_url: string | null; emailed: boolean }
const FORMS: [string, string][] = [["01", "Efectivo"], ["03", "Transferencia electrónica"], ["04", "Tarjeta de crédito"], ["28", "Tarjeta de débito"]];
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);
declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void }) => void } } }

/** Portal público: el cliente pide su factura con el folio y el total de su ticket, sin cuenta. */
export default function FacturarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const q = useQuery({ queryKey: ["autoinvoice", slug], queryFn: () => api<Info>(`/portal/${encodeURIComponent(slug)}/autoinvoice`), retry: false });
  const [step, setStep] = useState<"find" | "data" | "done">("find");
  const [folio, setFolio] = useState(""); const [total, setTotal] = useState(""); const [token, setToken] = useState<string | undefined>();
  const [found, setFound] = useState<Found | null>(null); const [done, setDone] = useState<Done | null>(null);
  const [f, setF] = useState({ rfc: "", name: "", regime: "", zip: "", use: "G03", email: "", form: "01", ok: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const cap = useRef<HTMLDivElement>(null); const siteKey = q.data?.captcha_site_key;
  useEffect(() => {
    if (!siteKey || step !== "find") return;
    const render = () => { if (cap.current && window.turnstile && !cap.current.hasChildNodes()) window.turnstile.render(cap.current, { sitekey: siteKey, callback: setToken, "expired-callback": () => setToken(undefined) }); };
    if (window.turnstile) { render(); return; }
    const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = render; document.head.appendChild(s);
  }, [siteKey, step]);
  const base = `/portal/${encodeURIComponent(slug)}/autoinvoice`;
  const p = q.data?.portal;

  async function lookup(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<Found>(`${base}/lookup`, { body: { folio: folio.trim(), total: total.trim(), captcha_token: token } }); setFound(r); setF((x) => ({ ...x, form: r.payment_form_code })); setStep("data"); }
    catch (er) { setError(err(er, "No se pudo buscar el ticket.")); } finally { setBusy(false); }
  }
  async function issue(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      setDone(await api<Done>(`${base}/issue`, { body: { folio: folio.trim(), total: total.trim(), captcha_token: token, payment_form_code: f.form, accept: f.ok, recipient: { tax_id: f.rfc.trim(), legal_name: f.name.trim(), tax_regime_code: f.regime, zip_code: f.zip.trim(), cfdi_use_code: f.use, email: f.email.trim() } } }));
      setStep("done");
    } catch (er) { setError(err(er, "No se pudo emitir la factura.")); } finally { setBusy(false); }
  }
  const sel = "h-10 w-full rounded-lg border bg-background px-2 text-sm";
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-4">
      <Link href="/" aria-label="Procura"><Logo size={22} textClassName="text-lg" /></Link>
      {q.isError ? <Card><CardHeader><CardTitle>Portal no disponible</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Este comercio no tiene activada la facturación en línea, o el enlace no es correcto.</CardContent></Card> : !p ? <div className="h-64 animate-pulse rounded-xl bg-muted" /> : (<>
        <div className="space-y-1"><p className="flex items-center gap-2 text-sm text-muted-foreground"><Receipt className="size-4" />Facturación en línea</p><h1 className="text-2xl font-semibold tracking-tight">{p.display_name}</h1>
          <p className="text-sm text-muted-foreground">{p.welcome_text ?? `Pide tu factura con el folio y el total de tu ticket. Tienes ${p.window_days} días desde tu compra.`}</p></div>
        {step === "find" && (
          <Card><CardContent className="pt-6"><form className="space-y-4" onSubmit={lookup}>
            <div className="space-y-1.5"><Label htmlFor="f-folio">Folio del ticket</Label><Input id="f-folio" autoFocus required maxLength={40} value={folio} onChange={(e) => setFolio(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-total">Total del ticket (MXN)</Label><Input id="f-total" required inputMode="decimal" placeholder="245.50" maxLength={20} value={total} onChange={(e) => setTotal(e.target.value)} /></div>
            {siteKey && <div ref={cap} />}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !folio.trim() || !total.trim() || (!!siteKey && !token)}>{busy ? "Buscando…" : "Buscar mi ticket"}</Button>
          </form></CardContent></Card>)}
        {step === "data" && found && (
          <Card><CardContent className="pt-6"><form className="space-y-4" onSubmit={issue}>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p className="font-medium">Ticket {found.folio} · {found.sold_at}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{found.lines.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.quantity} × {l.description}</span><span className="tabular-nums">{money(l.total_minor, found.currency)}</span></li>)}</ul>
              <p className="mt-2 flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(found.total_minor, found.currency)}</span></p></div>
            <div className="space-y-1.5"><Label htmlFor="d-rfc">RFC</Label><Input id="d-rfc" required maxLength={13} autoCapitalize="characters" value={f.rfc} onChange={(e) => setF({ ...f, rfc: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1.5"><Label htmlFor="d-name">Nombre o razón social (como aparece en tu constancia fiscal, sin el régimen societario)</Label><Input id="d-name" required maxLength={250} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5"><Label htmlFor="d-reg">Régimen fiscal</Label><select id="d-reg" required className={sel} value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}><option value="">Elige…</option>{SAT_REGIMES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="d-zip">Código postal fiscal</Label><Input id="d-zip" required inputMode="numeric" maxLength={5} value={f.zip} onChange={(e) => setF({ ...f, zip: e.target.value.replace(/\D/g, "") })} /></div>
              <div className="space-y-1.5"><Label htmlFor="d-use">Uso del CFDI</Label><select id="d-use" required className={sel} value={f.use} onChange={(e) => setF({ ...f, use: e.target.value })}>{SAT_USES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="d-form">Forma de pago</Label><select id="d-form" className={sel} value={f.form} onChange={(e) => setF({ ...f, form: e.target.value })}>{FORMS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="d-mail">Correo para tu factura</Label><Input id="d-mail" required type="email" maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.ok} onChange={(e) => setF({ ...f, ok: e.target.checked })} />Confirmo que mis datos fiscales son correctos. Una vez emitida, la factura solo se corrige cancelándola con el comercio.</label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setStep("find"); setError(null); }} disabled={busy}>Atrás</Button><Button type="submit" className="flex-1" disabled={busy || !f.ok}>{busy ? "Emitiendo…" : "Emitir mi factura"}</Button></div>
            <p className="text-xs text-muted-foreground">Usamos tus datos solo para emitir esta factura y enviártela. No necesitas crear una cuenta.</p>
          </form></CardContent></Card>)}
        {step === "done" && done && (
          <Card><CardContent className="space-y-3 pt-6 text-sm">
            <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="size-5 text-emerald-600" />Tu factura está lista</p>
            <p>Ticket {done.folio}. Folio fiscal: <span className="break-all font-mono text-xs">{done.fiscal_uuid}</span></p>
            <p className="text-muted-foreground">{done.emailed ? `Te enviamos tu factura a ${f.email}.` : "No pudimos enviarte el correo: descarga tus archivos ahora, los enlaces duran 15 minutos."}</p>
            <div className="flex flex-wrap gap-2">{done.pdf_url && <a className="inline-block rounded-lg border px-3 py-2 font-medium underline-offset-2 hover:underline" href={done.pdf_url} target="_blank" rel="noopener noreferrer">Descargar PDF</a>}{done.xml_url && <a className="inline-block rounded-lg border px-3 py-2 font-medium underline-offset-2 hover:underline" href={done.xml_url} target="_blank" rel="noopener noreferrer">Descargar XML</a>}</div>
            {!done.pdf_url && <p className="text-xs text-muted-foreground">El PDF no se pudo generar en este momento; con tu XML tienes tu comprobante fiscal y puedes pedir el PDF al comercio.</p>}
          </CardContent></Card>)}
      </>)}
    </main>
  );
}
