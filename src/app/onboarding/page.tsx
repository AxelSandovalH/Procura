"use client";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Handshake, Plus, ShoppingCart, Store, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { WizardFooter, WizardSteps } from "@/components/wizard/wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api-client";
import { toMinor } from "@/lib/format";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

type Uso = "compro" | "vendo" | "ambos";
interface Role { id: string; name: string; description: string | null; is_active: boolean; permission_codes: string[] }
interface InviteResult { email: string; ok: boolean; sent?: boolean; url?: string; error?: string }

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const err = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : fallback);
const AREAS = ["Compras", "Operaciones", "Administración", "Mantenimiento", "Finanzas"];
const TZ = [["America/Mazatlan", "Pacífico (La Paz, Mazatlán)"], ["America/Mexico_City", "Centro (Ciudad de México)"], ["America/Tijuana", "Noroeste (Tijuana)"], ["America/Cancun", "Sureste (Cancún)"], ["America/Hermosillo", "Sonora"]].map(([value, label]) => ({ value, label }));
const CURRENCY = [{ value: "MXN", label: "Peso mexicano (MXN)" }, { value: "USD", label: "Dólar estadounidense (USD)" }];
const USOS: { id: Uso; icon: typeof Store; title: string; text: string }[] = [
  { id: "compro", icon: ShoppingCart, title: "Compro", text: "Pido a proveedores: requisiciones, aprobaciones, cotizaciones y recepciones." },
  { id: "vendo", icon: Store, title: "Vendo", text: "Recibo solicitudes de clientes, cotizo, confirmo órdenes y registro entregas." },
  { id: "ambos", icon: Handshake, title: "Ambos", text: "Compro a mis proveedores y también vendo a mis clientes." },
];

export default function OnboardingPage() {
  const { memberships } = useSession();
  const qc = useQueryClient();
  const nextParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null;
  const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/inicio";

  // Organización
  const [name, setName] = useState(""); const [legal, setLegal] = useState(""); const [taxId, setTaxId] = useState("");
  const [slug, setSlug] = useState(""); const [slugTouched, setSlugTouched] = useState(false);
  const [country] = useState("MX"); const [currency, setCurrency] = useState("MXN"); const [tz, setTz] = useState("America/Mazatlan");
  const [orgId, setOrgId] = useState<string | null>(null);
  // Flujo
  const [uso, setUso] = useState<Uso | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  // Áreas
  const [areas, setAreas] = useState<string[]>(["Compras", "Operaciones"]); const [custom, setCustom] = useState("");
  const [location, setLocation] = useState("Oficina principal"); const [delivery, setDelivery] = useState(true);
  const [made, setMade] = useState<{ areas: string[]; location: boolean; workflow: boolean }>({ areas: [], location: false, workflow: false });
  // Aprobaciones
  const [mode, setMode] = useState<"none" | "all" | "above">("all"); const [amount, setAmount] = useState("10000"); const [approverId, setApproverId] = useState<string | null>(null); const [selfApprove, setSelfApprove] = useState(true);
  // Portal
  const [portal, setPortal] = useState(true); const [welcome, setWelcome] = useState(""); const [discoverable, setDiscoverable] = useState(false);
  // Equipo
  const [emails, setEmails] = useState(""); const [inviteRoleId, setInviteRoleId] = useState<string | null>(null); const [results, setResults] = useState<InviteResult[] | null>(null);

  const roles = useQuery({ queryKey: ["onboarding-roles", orgId], queryFn: () => api<{ data: Role[] }>("/organization/roles"), enabled: !!orgId });
  const roleList = useMemo(() => (roles.data?.data ?? []).filter((r) => r.is_active), [roles.data]);
  const approvers = roleList.filter((r) => r.permission_codes.includes("requisition.approve"));
  // Rol por defecto derivado (sin efectos): el elegido por la persona o, si no eligió, el sugerido.
  const approver = approverId ?? (approvers.find((r) => r.name === "Administrador") ?? approvers[0])?.id ?? null;
  const inviteRole = inviteRoleId ?? (roleList.find((r) => r.name === "Solicitante") ?? roleList[0])?.id ?? null;

  const buys = uso === "compro" || uso === "ambos", sells = uso === "vendo" || uso === "ambos";
  const flow = useMemo(() => ["Organización", "Uso", ...(buys ? ["Áreas", "Aprobaciones"] : []), ...(sells ? ["Portal"] : []), "Equipo", "Listo"], [buys, sells]);
  const current = flow[step];
  const go = (d: number) => { setError(null); setStep((s) => Math.max(0, Math.min(flow.length - 1, s + d))); };
  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); try { await fn(); go(1); } catch (e) { setError(err(e, "No se pudo guardar. Intenta de nuevo.")); } finally { setBusy(false); } }

  const createOrg = () => run(async () => {
    if (orgId) return;
    const r = await api<{ organization: { id: string } }>("/organizations", { body: { display_name: name.trim(), legal_name: (legal || name).trim(), slug, tax_id: taxId.trim() || undefined, country, base_currency: currency, timezone: tz } });
    setOrgId(r.organization.id); await qc.invalidateQueries();
  });
  const saveUso = () => { if (orgId && uso) try { localStorage.setItem(`procura:uso:${orgId}`, uso); } catch { /* opcional */ } go(1); };
  const saveAreas = () => run(async () => {
    for (const a of areas.filter((x) => !made.areas.includes(x))) { await api("/organization/departments", { body: { name: a } }); setMade((m) => ({ ...m, areas: [...m.areas, a] })); }
    if (location.trim() && !made.location) { await api("/organization/locations", { body: { name: location.trim(), is_delivery_point: delivery } }); setMade((m) => ({ ...m, location: true })); }
  });
  const saveApprovals = () => run(async () => {
    if (mode === "none" || made.workflow) return;
    const wf = await api<{ id: string }>("/organization/approval-workflows", { body: { name: "Aprobación general", is_default: true } });
    await api(`/organization/approval-workflows/${wf.id}/rules`, { body: { level: 1, approver_type: "ROLE", approver_role_id: approver, condition: mode === "above" ? { min_amount_minor: toMinor(amount) } : {} } });
    await api("/organization/settings", { method: "PATCH", body: { requester_can_self_approve: selfApprove } });
    setMade((m) => ({ ...m, workflow: true }));
  });
  const savePortal = () => run(async () => {
    await api("/organization/settings", { method: "PATCH", body: { portal_enabled: portal, portal_welcome_text: portal && welcome.trim() ? welcome.trim() : null } });
    if (discoverable) await api("/organization", { method: "PATCH", body: { is_discoverable: true } });
  });
  async function sendInvites() {
    setBusy(true); setError(null);
    const list = [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const out: InviteResult[] = [];
    for (const email of list) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.push({ email, ok: false, error: "Correo no válido" }); continue; }
      try { const r = await api<{ url: string; email_sent: boolean }>("/organization/invitations", { body: { kind: "MEMBERSHIP", email, role_ids: inviteRole ? [inviteRole] : [], send_email: true, expires_in_days: 14 } }); out.push({ email, ok: true, sent: r.email_sent, url: r.url }); }
      catch (e) { out.push({ email, ok: false, error: err(e, "No se pudo crear") }); }
    }
    setResults(out); setBusy(false);
  }
  const finish = () => { if (orgId) try { localStorage.setItem(`procura:onboarding:${orgId}`, "done"); } catch { /* opcional */ }
    window.location.assign(safeNext); // recarga completa: estado limpio con la organización nueva
  };

  const toggleArea = (a: string) => setAreas((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));
  const addCustom = () => { const v = custom.trim(); if (v && !areas.includes(v)) setAreas((l) => [...l, v]); setCustom(""); };
  // Host real de la ventana sin desajuste de hidratación (el servidor no lo conoce).
  const site = useSyncExternalStore(() => () => {}, () => window.location.host, () => "procuraos.app");
  const invited = results?.filter((r) => r.ok).length ?? 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-5 py-8">
      <div className="flex items-center justify-between"><Logo size={22} textClassName="text-lg" />{memberships.length > 0 && !orgId && <Link href="/inicio" className="text-sm text-muted-foreground underline-offset-4 hover:underline">Volver</Link>}</div>
      <WizardSteps steps={flow} current={step} />
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        {current === "Organización" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Crea tu organización</h1><p className="text-sm text-muted-foreground">Serás su administrador principal. Lo demás lo configuramos en unos pasos.</p></div>
          {orgId ? <p className="rounded-lg border px-3 py-2 text-sm"><Check className="mr-1.5 inline size-4 text-emerald-600" />Tu organización <b>{name}</b> ya está creada.</p> : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && slug.length >= 3) void createOrg(); }}>
              <div className="space-y-1.5"><Label htmlFor="name">Nombre comercial *</Label><Input id="name" required value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} placeholder="Ej. Papillon Yachts" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="legal">Razón social <span className="text-muted-foreground">(opcional)</span></Label><Input id="legal" value={legal} onChange={(e) => setLegal(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="rfc">RFC <span className="text-muted-foreground">(opcional)</span></Label><Input id="rfc" value={taxId} maxLength={20} onChange={(e) => setTaxId(e.target.value.toUpperCase())} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="slug">Dirección en Procura</Label>
                <div className="flex items-center rounded-lg border border-input text-sm focus-within:ring-3 focus-within:ring-ring/50"><span className="pl-2.5 text-muted-foreground">{site}/</span><input id="slug" required minLength={3} value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} className="h-8 min-w-0 flex-1 bg-transparent px-1 outline-none" /></div>
                <p className="text-xs text-muted-foreground">Es la dirección de tu portal si vendes. Solo minúsculas, números y guiones.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Moneda</Label><Select items={CURRENCY} value={currency} onValueChange={(v) => setCurrency(v ?? "MXN")}><SelectTrigger className="w-full" aria-label="Moneda"><SelectValue /></SelectTrigger><SelectContent>{CURRENCY.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Zona horaria</Label><Select items={TZ} value={tz} onValueChange={(v) => setTz(v ?? "America/Mazatlan")}><SelectTrigger className="w-full" aria-label="Zona horaria"><SelectValue /></SelectTrigger><SelectContent>{TZ.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <button type="submit" className="sr-only">Crear</button>
            </form>)}
          <WizardFooter onNext={() => (orgId ? go(1) : void createOrg())} busy={busy} disabled={!orgId && (!name.trim() || slug.length < 3)} nextLabel={orgId ? "Continuar" : "Crear organización"} />
        </>)}

        {current === "Uso" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">¿Cómo usarás Procura?</h1><p className="text-sm text-muted-foreground">Así te mostramos solo lo que necesitas. Puedes cambiarlo después: no bloquea nada.</p></div>
          <div role="radiogroup" aria-label="Uso de Procura" className="grid gap-3">
            {USOS.map((u) => (
              <button key={u.id} type="button" role="radio" aria-checked={uso === u.id} onClick={() => setUso(u.id)} className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50", uso === u.id && "border-primary bg-muted/60 ring-1 ring-primary")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><u.icon className="size-4" /></span>
                <span><span className="block font-medium">{u.title}</span><span className="block text-sm text-muted-foreground">{u.text}</span></span>
              </button>))}
          </div>
          <WizardFooter onBack={() => go(-1)} onNext={saveUso} disabled={!uso} />
        </>)}

        {current === "Áreas" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Áreas y lugar de entrega</h1><p className="text-sm text-muted-foreground">Sirven para organizar quién pide y a dónde llega lo comprado. Puedes cambiarlas cuando quieras.</p></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Áreas de tu empresa</legend>
            <div className="flex flex-wrap gap-2">{[...AREAS, ...areas.filter((a) => !AREAS.includes(a))].map((a) => (
              <button key={a} type="button" aria-pressed={areas.includes(a)} onClick={() => toggleArea(a)} className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm", areas.includes(a) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{areas.includes(a) && <Check className="size-3.5" />}{a}</button>))}</div>
            <div className="flex gap-2"><Input aria-label="Otra área" placeholder="Otra área…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} /><Button type="button" variant="outline" onClick={addCustom} disabled={!custom.trim()}><Plus />Agregar</Button></div>
          </fieldset>
          <div className="space-y-1.5"><Label htmlFor="loc">Lugar principal de entrega</Label><Input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} />Es un punto de entrega</label></div>
          <WizardFooter onBack={() => go(-1)} onNext={() => void saveAreas()} busy={busy} onSkip={() => go(1)} />
        </>)}

        {current === "Aprobaciones" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">¿Quién aprueba las compras?</h1><p className="text-sm text-muted-foreground">Cada requisición pasa por la aprobación que definas antes de pedir cotizaciones.</p></div>
          <div role="radiogroup" aria-label="Regla de aprobación" className="grid gap-2">
            {([["all", "Aprobar todas las requisiciones", "Una persona con el rol elegido revisa cada una."], ["above", "Aprobar solo las de monto alto", "Las menores se aprueban solas."], ["none", "Sin aprobación por ahora", "Todo se aprueba automáticamente; puedes definirlo después."]] as const).map(([id, t, d]) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={cn("rounded-xl border p-3 text-left hover:bg-muted/50", mode === id && "border-primary bg-muted/60 ring-1 ring-primary")}><span className="block font-medium">{t}</span><span className="block text-sm text-muted-foreground">{d}</span></button>))}
          </div>
          {mode !== "none" && (
            <div className="space-y-3 rounded-xl border p-4">
              {mode === "above" && <div className="space-y-1.5"><Label htmlFor="amt">Aprobar desde ({currency})</Label><Input id="amt" inputMode="decimal" className="w-40" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
              <div className="space-y-1.5"><Label>Aprueba el rol</Label>
                <Select items={approvers.map((r) => ({ value: r.id, label: r.name }))} value={approver} onValueChange={setApproverId}><SelectTrigger className="w-full" aria-label="Rol aprobador"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{approvers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={selfApprove} onChange={(e) => setSelfApprove(e.target.checked)} /><span>Puedo aprobar mis propias requisiciones<span className="block text-xs text-muted-foreground">Útil mientras estás solo y pruebas. Desactívalo cuando tu equipo esté dentro (Administración → Organización).</span></span></label>
            </div>)}
          <WizardFooter onBack={() => go(-1)} onNext={() => void saveApprovals()} busy={busy} disabled={mode !== "none" && (!approver || (mode === "above" && !(toMinor(amount) > 0)))} onSkip={() => go(1)} />
        </>)}

        {current === "Portal" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Tu portal para clientes</h1><p className="text-sm text-muted-foreground">Un enlace público donde tus clientes te piden cotización. Siempre requiere iniciar sesión: no hay solicitudes anónimas.</p></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={portal} onChange={(e) => setPortal(e.target.checked)} /><span>Activar mi portal<span className="block font-mono text-xs text-muted-foreground">{site}/{slug}/solicitar</span></span></label>
          {portal && <div className="space-y-1.5"><Label htmlFor="wel">Texto de bienvenida <span className="text-muted-foreground">(opcional)</span></Label><Textarea id="wel" rows={3} maxLength={2000} placeholder="Qué vendes y cómo pueden pedirte cotización." value={welcome} onChange={(e) => setWelcome(e.target.value)} /></div>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} /><span>Permitir que otras empresas me encuentren al buscar<span className="block text-xs text-muted-foreground">Por defecto eres invisible: solo te ven quienes ya tienen relación contigo o tu enlace.</span></span></label>
          <p className="text-xs text-muted-foreground">Tu catálogo lo cargas después desde Catálogo → Importar (Excel o CSV); es privado y compartes solo lo que quieras.</p>
          <WizardFooter onBack={() => go(-1)} onNext={() => void savePortal()} busy={busy} onSkip={() => go(1)} />
        </>)}

        {current === "Equipo" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Invita a tu equipo</h1><p className="text-sm text-muted-foreground">Les enviamos un correo con un enlace para unirse a {name || "tu organización"}. Puedes invitar a más personas después.</p></div>
          {!results ? (<>
            <div className="space-y-1.5"><Label htmlFor="em">Correos (uno por línea o separados por comas)</Label><Textarea id="em" rows={4} placeholder={"ana@empresa.com\nluis@empresa.com"} value={emails} onChange={(e) => setEmails(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Rol al entrar</Label>
              <Select items={roleList.map((r) => ({ value: r.id, label: r.name }))} value={inviteRole} onValueChange={setInviteRoleId}><SelectTrigger className="w-full" aria-label="Rol de los invitados"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{roleList.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.description ? ` — ${r.description}` : ""}</SelectItem>)}</SelectContent></Select></div>
            <WizardFooter onBack={() => go(-1)} onNext={() => void sendInvites()} nextLabel="Enviar invitaciones" busy={busy} disabled={!emails.trim() || !inviteRole} onSkip={() => go(1)} skipLabel="Invitar después" />
          </>) : (<>
            <ul className="divide-y rounded-xl border text-sm">{results.map((r) => (
              <li key={r.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0"><span className="block truncate font-medium">{r.email}</span><span className={cn("block text-xs", r.ok ? "text-muted-foreground" : "text-destructive")}>{r.ok ? (r.sent ? "Invitación enviada por correo" : "Creada; el correo no salió: copia el enlace") : r.error}</span></span>
                {r.ok && r.url && !r.sent && <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(r.url!)}><Copy />Copiar enlace</Button>}
                {r.ok && r.sent && <Check className="size-4 shrink-0 text-emerald-600" />}{!r.ok && <X className="size-4 shrink-0 text-destructive" />}
              </li>))}</ul>
            <WizardFooter onBack={() => setResults(null)} onNext={() => go(1)} />
          </>)}
        </>)}

        {current === "Listo" && (<>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">¡Todo listo!</h1><p className="text-sm text-muted-foreground">{name} ya está en Procura. Esto es lo que dejamos configurado:</p></div>
          <ul className="space-y-2 rounded-xl border p-4 text-sm">
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />Organización creada, con tu usuario como administrador principal</li>
            {buys && made.areas.length > 0 && <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />Áreas: {made.areas.join(", ")}{made.location ? ` · Entrega: ${location}` : ""}</li>}
            {buys && made.workflow && <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />Aprobación {mode === "above" ? `desde ${amount} ${currency}` : "de todas las requisiciones"}</li>}
            {sells && portal && <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />Portal activo en {site}/{slug}/solicitar</li>}
            {invited > 0 && <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{invited} {invited === 1 ? "invitación creada" : "invitaciones creadas"}</li>}
          </ul>
          <p className="text-sm text-muted-foreground">En tu panel verás una lista de <b>Primeros pasos</b> con lo que sigue: {buys ? "conectar con tus proveedores y hacer tu primera requisición" : "cargar tu catálogo y compartir tu portal con tus clientes"}.</p>
          <WizardFooter onBack={() => go(-1)} onNext={finish} nextLabel="Ir a mi panel" />
        </>)}
      </div>
    </main>
  );
}
