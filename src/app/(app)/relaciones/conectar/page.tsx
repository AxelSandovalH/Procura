"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Mail, Search, Share2, ShoppingCart, Store } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { WizardFooter, WizardSteps } from "@/components/wizard/wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Tipo = "proveedor" | "cliente";
type Metodo = "buscar" | "invitar" | "portal" | "compartir";
interface Org { id: string; slug: string; display_name: string; country: string | null }

const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);

function Card({ selected, onClick, icon: Icon, title, text }: { selected: boolean; onClick: () => void; icon: typeof Store; title: string; text: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50", selected && "border-primary bg-muted/60 ring-1 ring-primary")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon className="size-4" /></span>
      <span><span className="block font-medium">{title}</span><span className="block text-sm text-muted-foreground">{text}</span></span>
    </button>
  );
}

function Conectar() {
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const initial = useSearchParams().get("tipo");
  const [tipo, setTipo] = useState<Tipo | null>(initial === "proveedor" || initial === "cliente" ? initial : null);
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [step, setStep] = useState(initial === "proveedor" || initial === "cliente" ? 1 : 0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  // Buscar
  const [term, setTerm] = useState(""); const [results, setResults] = useState<Org[] | null>(null); const [picked, setPicked] = useState<Org | null>(null); const [message, setMessage] = useState("");
  // Invitar
  const [email, setEmail] = useState("");
  // Portal
  const [portalInput, setPortalInput] = useState("");
  // Resultado
  const [done, setDone] = useState<{ kind: "solicitud" | "invitacion"; org?: string; url?: string; emailSent?: boolean; email?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const isBuyer = tipo === "proveedor";                 // "le compro" → yo soy el comprador
  const steps = ["Relación", "Cómo", "Detalles", "Listo"];
  const go = (d: number) => { setError(null); setStep((s) => Math.max(0, Math.min(3, s + d))); };
  const canRequest = session.can("relationship.request");
  const myPortal = session.org ? `${typeof window !== "undefined" ? window.location.origin : ""}/${session.org.slug}/solicitar` : "";

  async function search() {
    setBusy(true); setError(null); setPicked(null);
    try { setResults((await api<{ data: Org[] }>(`/organizations/search?q=${encodeURIComponent(term.trim())}`)).data); } catch (e) { setResults(null); setError(err(e, "No se pudo buscar.")); }
    finally { setBusy(false); }
  }
  async function sendRequest() {
    setBusy(true); setError(null);
    try {
      await api("/relationships", { body: { counterpart_organization_id: picked!.id, my_position: isBuyer ? "BUYER" : "SUPPLIER", message: message.trim() || undefined } });
      await qc.invalidateQueries({ queryKey: ["relationships"] }); setDone({ kind: "solicitud", org: picked!.display_name }); setStep(3);
    } catch (e) { setError(err(e, "No se pudo enviar la solicitud.")); } finally { setBusy(false); }
  }
  async function invite() {
    setBusy(true); setError(null);
    const mail = email.trim().toLowerCase();
    try {
      const r = await api<{ url: string; email_sent: boolean }>("/organization/invitations", { body: { kind: "RELATIONSHIP", relationship_position: isBuyer ? "SUPPLIER" : "BUYER", email: mail || undefined, send_email: !!mail, expires_in_days: 14, max_uses: 1 } });
      await qc.invalidateQueries({ queryKey: ["invitations"] }); setDone({ kind: "invitacion", url: r.url, emailSent: r.email_sent, email: mail || undefined }); setStep(3);
    } catch (e) { setError(err(e, "No se pudo crear la invitación.")); } finally { setBusy(false); }
  }
  function openPortal() {
    const m = portalInput.trim().match(/([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\/solicitar\/?(?:[?#].*)?$/i) ?? portalInput.trim().match(/^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])$/i);
    if (!m) { setError("Pega el enlace de su portal (termina en /solicitar) o solo su nombre corto."); return; }
    router.push(`/${m[1].toLowerCase()}/solicitar`);
  }
  async function copy(text: string) { await navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  if (!session.loading && !canRequest) return <p className="text-sm text-muted-foreground">Tu rol no permite crear relaciones. Pide a un administrador el permiso «Solicitar relaciones».</p>;

  const detailsReady = metodo === "buscar" ? !!picked : metodo === "invitar" ? (email.trim() === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) : metodo === "portal" ? portalInput.trim().length > 1 : true;
  const metodos: { id: Metodo; icon: typeof Store; title: string; text: string; show: boolean }[] = [
    { id: "buscar", icon: Search, title: "Buscarlo en Procura", text: "Si ya usa Procura y permite que lo encuentren. Le llega una solicitud para aceptar.", show: true },
    { id: "invitar", icon: Mail, title: "Invitarlo por correo o enlace", text: "Funciona aunque aún no tenga cuenta. Al aceptar, la relación queda activa al instante.", show: true },
    { id: "portal", icon: Link2, title: "Tengo el enlace de su portal", text: "Si su portal ya existe, entra desde ahí y pide relacionarse.", show: isBuyer },
    { id: "compartir", icon: Share2, title: "Compartir mi portal", text: "Tu enlace público donde tus clientes te piden cotización.", show: !isBuyer },
  ];

  return (
    <>
      <PageHeader title="Conectar con un proveedor o cliente" description="Toda cotización y orden viaja por una relación aceptada por ambas partes." />
      <div className="max-w-2xl space-y-6">
        <WizardSteps steps={steps} current={step} />
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        {step === 0 && (<>
          <h2 className="text-lg font-semibold">¿Con quién quieres conectar?</h2>
          <div role="radiogroup" aria-label="Tipo de relación" className="grid gap-3">
            <Card selected={tipo === "proveedor"} onClick={() => setTipo("proveedor")} icon={ShoppingCart} title="Con un proveedor" text="Le voy a comprar: le pediré cotizaciones y órdenes." />
            <Card selected={tipo === "cliente"} onClick={() => setTipo("cliente")} icon={Store} title="Con un cliente" text="Le voy a vender: recibiré sus solicitudes y cotizaré." />
          </div>
          <WizardFooter onNext={() => go(1)} disabled={!tipo} />
        </>)}

        {step === 1 && (<>
          <h2 className="text-lg font-semibold">¿Cómo quieres conectar con {isBuyer ? "tu proveedor" : "tu cliente"}?</h2>
          <div role="radiogroup" aria-label="Método" className="grid gap-3">{metodos.filter((m) => m.show).map((m) => <Card key={m.id} selected={metodo === m.id} onClick={() => setMetodo(m.id)} icon={m.icon} title={m.title} text={m.text} />)}</div>
          <WizardFooter onBack={() => { setTipo(initial ? tipo : null); setMetodo(null); go(-1); }} onNext={() => go(1)} disabled={!metodo} />
        </>)}

        {step === 2 && metodo === "buscar" && (<>
          <h2 className="text-lg font-semibold">Busca a {isBuyer ? "tu proveedor" : "tu cliente"}</h2>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (term.trim().length >= 2) void search(); }}>
            <Input aria-label="Buscar organización" placeholder="Nombre de la organización" value={term} onChange={(e) => setTerm(e.target.value)} />
            <Button type="submit" variant="outline" disabled={busy || term.trim().length < 2}><Search />Buscar</Button>
          </form>
          {results && (results.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No encontramos coincidencias. Puede que no use Procura o que no permita ser encontrada. <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => { setMetodo("invitar"); setResults(null); }}>Invítala con un enlace</button>.</p>
          ) : (
            <ul role="radiogroup" aria-label="Resultados" className="space-y-1.5">{results.map((o) => (
              <li key={o.id}><button type="button" role="radio" aria-checked={picked?.id === o.id} onClick={() => setPicked(o)} className={cn("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted", picked?.id === o.id && "border-primary bg-muted ring-1 ring-primary")}><span className="font-medium">{o.display_name}</span><span className="text-xs text-muted-foreground">{o.country ?? ""}</span></button></li>))}</ul>))}
          {picked && <div className="space-y-1.5"><Label htmlFor="msg">Mensaje para {picked.display_name} <span className="text-muted-foreground">(opcional)</span></Label><Textarea id="msg" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Quiénes son y qué necesitan." /></div>}
          <WizardFooter onBack={() => go(-1)} onNext={() => void sendRequest()} nextLabel="Enviar solicitud" busy={busy} disabled={!picked} />
        </>)}

        {step === 2 && metodo === "invitar" && (<>
          <h2 className="text-lg font-semibold">Invita a {isBuyer ? "tu proveedor" : "tu cliente"}</h2>
          <div className="space-y-1.5"><Label htmlFor="mail">Correo de la persona a invitar <span className="text-muted-foreground">(opcional)</span></Label><Input id="mail" type="email" placeholder="contacto@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-xs text-muted-foreground">Con correo, se lo enviamos nosotros. Sin correo, te damos un enlace para compartir por WhatsApp o donde prefieras. Dura 14 días y sirve una sola vez.</p></div>
          <WizardFooter onBack={() => go(-1)} onNext={() => void invite()} nextLabel={email.trim() ? "Enviar invitación" : "Crear enlace"} busy={busy} disabled={!detailsReady} />
        </>)}

        {step === 2 && metodo === "portal" && (<>
          <h2 className="text-lg font-semibold">Entra por el portal de tu proveedor</h2>
          <div className="space-y-1.5"><Label htmlFor="portal">Enlace de su portal</Label><Input id="portal" placeholder="https://www.procuraos.app/su-empresa/solicitar" value={portalInput} onChange={(e) => setPortalInput(e.target.value)} />
            <p className="text-xs text-muted-foreground">Te llevamos a su portal, donde puedes pedirle relacionarse con tu organización.</p></div>
          <WizardFooter onBack={() => go(-1)} onNext={openPortal} nextLabel="Abrir portal" disabled={!detailsReady} />
        </>)}

        {step === 2 && metodo === "compartir" && (<>
          <h2 className="text-lg font-semibold">Comparte tu portal</h2>
          {session.org && (<div className="space-y-3 rounded-xl border p-4 text-sm">
            <p>Tus clientes abren este enlace, inician sesión y te piden relacionarse. Tú aceptas y quedan conectados.</p>
            <div className="flex gap-2"><Input readOnly aria-label="Enlace de tu portal" value={myPortal} onFocus={(e) => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => void copy(myPortal)}><Copy />{copied ? "Copiado" : "Copiar"}</Button></div>
            <p className="text-xs text-muted-foreground">Si aún no responde, activa tu portal en <Link href="/administracion/organizacion" className="underline underline-offset-4">Administración → Organización</Link>.</p>
          </div>)}
          <WizardFooter onBack={() => go(-1)} onNext={() => { setDone(null); go(1); }} nextLabel="Listo" />
        </>)}

        {step === 3 && (<>
          <div className="space-y-4 rounded-xl border p-5">
            <div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="size-4" /></span>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">{done?.kind === "solicitud" ? "Solicitud enviada" : done?.kind === "invitacion" ? "Invitación lista" : "Portal listo para compartir"}</h2>
                <p className="text-sm text-muted-foreground">
                  {done?.kind === "solicitud" && <>{done.org} recibió tu solicitud y una notificación. Cuando la acepte, {isBuyer ? "podrás pedirle cotizaciones" : "podrán intercambiar cotizaciones y órdenes"}.</>}
                  {done?.kind === "invitacion" && (done.emailSent ? <>Enviamos la invitación a <b>{done.email}</b>. Al aceptarla, la relación queda activa.</> : <>{done.email ? "No pudimos enviar el correo, pero el enlace está listo. " : ""}Comparte este enlace: al aceptarlo, la relación queda activa.</>)}
                  {!done && "Comparte tu enlace con tus clientes. Verás sus solicitudes en Relaciones."}
                </p>
              </div></div>
            {done?.kind === "invitacion" && done.url && !done.emailSent && (
              <div className="flex gap-2"><Input readOnly aria-label="Enlace de invitación" value={done.url} onFocus={(e) => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => void copy(done.url!)}><Copy />{copied ? "Copiado" : "Copiar"}</Button></div>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { setDone(null); setMetodo(null); setPicked(null); setResults(null); setTerm(""); setEmail(""); setMessage(""); setStep(initial ? 1 : 0); if (!initial) setTipo(null); }}>Conectar con otro</Button>
            <Link href="/relaciones" className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80">Ver mis relaciones</Link>
          </div>
        </>)}
      </div>
    </>
  );
}

export default function ConectarPage() { return <Suspense><Conectar /></Suspense>; }
