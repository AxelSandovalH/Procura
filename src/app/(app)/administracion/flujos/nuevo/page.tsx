"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { WizardFooter, WizardSteps } from "@/components/wizard/wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { money, toMinor } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Role { id: string; name: string; is_active: boolean; permission_codes: string[] }
interface Member { id: string; status: string; user: { full_name: string } }
interface Dept { id: string; name: string }
interface Workflow { id: string; name: string; is_default: boolean; is_active: boolean }
interface Settings { requester_can_self_approve: boolean; reapproval_policy: string }
type Approver = "ROLE" | "MEMBERSHIP" | "DEPARTMENT_HEAD";
interface Level { from: string; type: Approver; target: string | null; mode: "ANY_ONE" | "ALL" }

const TYPES = [{ value: "GOODS", label: "Bienes" }, { value: "SERVICE", label: "Servicios" }, { value: "MIXED", label: "Mixtas" }];
const APPROVER = [{ value: "ROLE", label: "Un rol" }, { value: "MEMBERSHIP", label: "Una persona" }, { value: "DEPARTMENT_HEAD", label: "Jefe del departamento" }];
const MODE = [{ value: "ANY_ONE", label: "Basta con uno" }, { value: "ALL", label: "Todos deben aprobar" }];
const REAPP = [{ value: "ALWAYS", label: "Siempre que se edite" }, { value: "IF_AMOUNT_INCREASES", label: "Solo si el monto aumenta" }, { value: "NEVER", label: "Nunca" }];
const err = (e: unknown, f: string) => (e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : f);
const blank = (from = ""): Level => ({ from, type: "ROLE", target: null, mode: "ANY_ONE" });

export default function NuevoFlujo() {
  const session = useSession();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  // Flujo
  const [name, setName] = useState("Aprobación general"); const [scope, setScope] = useState<"all" | "some">("all"); const [types, setTypes] = useState<string[]>([]); const [depts, setDepts] = useState<string[]>([]);
  // Niveles
  const [levels, setLevels] = useState<Level[]>([blank()]);
  // Ajustes
  const [self, setSelf] = useState<boolean | null>(null); const [reapp, setReapp] = useState<string | null>(null);
  const [sim, setSim] = useState("30000");
  // Progreso de creación (para reintentar sin duplicar)
  const [wfId, setWfId] = useState<string | null>(null); const [made, setMade] = useState(0); const [finished, setFinished] = useState(false);

  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/organization/roles") });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<{ data: Member[] }>("/organization/members") });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => api<{ data: Dept[] }>("/organization/departments") });
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: () => api<{ data: Workflow[] }>("/organization/approval-workflows") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/organization/settings") });
  const approvers = (roles.data?.data ?? []).filter((r) => r.is_active && r.permission_codes.includes("requisition.approve"));
  const people = (members.data?.data ?? []).filter((m) => m.status === "ACTIVE");
  const currentDefault = (workflows.data?.data ?? []).find((w) => w.is_default && w.is_active);
  const selfNow = self ?? settings.data?.requester_can_self_approve ?? false;
  const reappNow = reapp ?? settings.data?.reapproval_policy ?? "ALWAYS";
  const currency = session.org?.base_currency ?? "MXN";

  const setLevel = (i: number, patch: Partial<Level>) => setLevels((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const preset = (n: 1 | 2 | 3) => setLevels(n === 1 ? [blank()] : n === 2 ? [blank(), blank("50000")] : [blank(), blank("50000"), blank("200000")]);
  const toggle = (list: string[], v: string, set: (l: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const from = (l: Level, i: number) => (i === 0 ? (l.from.trim() ? toMinor(l.from) : 0) : toMinor(l.from));
  const targetName = (l: Level) => l.type === "DEPARTMENT_HEAD" ? "Jefe del departamento" : l.type === "ROLE" ? (approvers.find((r) => r.id === l.target)?.name ?? "—") : (people.find((m) => m.id === l.target)?.user.full_name ?? "—");
  const levelsValid = levels.length > 0 && levels.every((l, i) => (l.type === "DEPARTMENT_HEAD" || !!l.target) && (i === 0 || from(l, i) > from(levels[i - 1], i - 1)));
  const scopeValid = scope === "all" || types.length > 0 || depts.length > 0;
  const range = (i: number) => { const a = from(levels[i], i); return a > 0 ? `desde ${money(a, currency)}` : "cualquier monto"; };

  // Simulador: mismo criterio que el motor (mínimo inclusive; los niveles que aplican se aprueban en orden).
  const simMinor = toMinor(sim || "0");
  const simPath = levels.map((l, i) => ({ l, i })).filter(({ l, i }) => from(l, i) <= simMinor);

  async function create() {
    setBusy(true); setError(null);
    try {
      let id = wfId;
      if (!id) {
        const wf = await api<{ id: string }>("/organization/approval-workflows", { body: { name: name.trim(), is_default: scope === "all", applies_to: scope === "all" ? {} : { ...(types.length ? { requisition_types: types } : {}), ...(depts.length ? { department_ids: depts } : {}) } } });
        id = wf.id; setWfId(id);
      }
      for (let i = made; i < levels.length; i++) {
        const l = levels[i]; const a = from(l, i);
        await api(`/organization/approval-workflows/${id}/rules`, { body: { level: i + 1, approver_type: l.type, decision_mode: l.mode, ...(l.type === "ROLE" ? { approver_role_id: l.target } : l.type === "MEMBERSHIP" ? { approver_membership_id: l.target } : {}), condition: a > 0 ? { min_amount_minor: a } : {} } });
        setMade(i + 1);
      }
      if (self !== null || reapp !== null) await api("/organization/settings", { method: "PATCH", body: { ...(self !== null ? { requester_can_self_approve: self } : {}), ...(reapp !== null ? { reapproval_policy: reapp } : {}) } });
      await Promise.all(["workflows", "settings", "onboarding-status"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setFinished(true); setStep(3);
    } catch (e) { setError(`${err(e, "No se pudo crear el flujo.")}${wfId || made ? " Lo ya creado se conserva: al reintentar continúa donde se quedó." : ""}`); }
    finally { setBusy(false); }
  }

  if (!session.loading && !session.can("approval_workflow.manage")) return <p className="text-sm text-muted-foreground">Tu rol no permite configurar flujos de aprobación.</p>;
  const steps = ["Flujo", "Niveles", "Revisión", "Listo"];
  const go = (d: number) => { setError(null); setStep((s) => Math.max(0, Math.min(3, s + d))); };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Nuevo flujo de aprobación</h1><p className="text-sm text-muted-foreground">Define quién aprueba las requisiciones, según su monto, tipo o área.</p></div>
      <WizardSteps steps={steps} current={step} />
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {step === 0 && (<>
        <div className="space-y-1.5"><Label htmlFor="wf-name">Nombre del flujo</Label><Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">¿A qué requisiciones aplica?</legend>
          <div role="radiogroup" aria-label="Alcance" className="grid gap-2">
            {([["all", "A todas", "Es el flujo predeterminado: lo usan todas las requisiciones que no tengan uno más específico."], ["some", "Solo a algunas", "Por tipo (bienes, servicios) o por departamento. Lo demás sigue usando el predeterminado."]] as const).map(([id, t, d]) => (
              <button key={id} type="button" role="radio" aria-checked={scope === id} onClick={() => setScope(id)} className={cn("rounded-xl border p-3 text-left hover:bg-muted/50", scope === id && "border-primary bg-muted/60 ring-1 ring-primary")}><span className="block font-medium">{t}</span><span className="block text-sm text-muted-foreground">{d}</span></button>))}
          </div>
        </fieldset>
        {scope === "all" && currentDefault && <p className="rounded-lg bg-muted px-3 py-2 text-sm">Ya tienes un flujo predeterminado («{currentDefault.name}»). Este lo reemplazará como predeterminado; el anterior se conserva.</p>}
        {scope === "some" && (
          <div className="space-y-4 rounded-xl border p-4">
            <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Tipo de requisición</legend><div className="flex flex-wrap gap-3">{TYPES.map((t) => <label key={t.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={types.includes(t.value)} onChange={() => toggle(types, t.value, setTypes)} />{t.label}</label>)}</div></fieldset>
            <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Departamento</legend>
              {(departments.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Aún no tienes departamentos. <Link href="/administracion/estructura" className="underline underline-offset-4">Créalos</Link> para poder elegirlos.</p> :
                <div className="flex flex-wrap gap-3">{departments.data!.data.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={depts.includes(d.id)} onChange={() => toggle(depts, d.id, setDepts)} />{d.name}</label>)}</div>}</fieldset>
            <p className="text-xs text-muted-foreground">Si marcas tipo y departamento, deben cumplirse ambos.</p>
          </div>)}
        <WizardFooter onNext={() => go(1)} disabled={!name.trim() || !scopeValid} />
      </>)}

      {step === 1 && (<>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Cada nivel aprueba en orden. Un nivel con «desde» solo interviene cuando el monto lo alcanza.</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Plantillas"><span className="self-center text-xs text-muted-foreground">Empezar con:</span>
            <Button type="button" size="sm" variant="outline" onClick={() => preset(1)}>1 nivel</Button><Button type="button" size="sm" variant="outline" onClick={() => preset(2)}>2 niveles por monto</Button><Button type="button" size="sm" variant="outline" onClick={() => preset(3)}>3 niveles por monto</Button></div>
        </div>
        <ol className="space-y-3">{levels.map((l, i) => {
          const targets = l.type === "ROLE" ? approvers.map((r) => ({ value: r.id, label: r.name })) : people.map((m) => ({ value: m.id, label: m.user.full_name }));
          return (
            <li key={i} className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between"><h3 className="font-medium">Nivel {i + 1}</h3>{levels.length > 1 && <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar nivel ${i + 1}`} onClick={() => setLevels((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor={`from-${i}`}>{i === 0 ? `Desde (${currency}, vacío = cualquier monto)` : `Desde (${currency})`}</Label><Input id={`from-${i}`} inputMode="decimal" value={l.from} onChange={(e) => setLevel(i, { from: e.target.value })} placeholder={i === 0 ? "Cualquier monto" : "50,000"} /></div>
                <div className="space-y-1.5"><Label>Aprueba</Label><Select items={APPROVER} value={l.type} onValueChange={(v) => setLevel(i, { type: (v ?? "ROLE") as Approver, target: null })}><SelectTrigger className="w-full" aria-label={`Tipo de aprobador del nivel ${i + 1}`}><SelectValue /></SelectTrigger><SelectContent>{APPROVER.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent></Select></div>
                {l.type !== "DEPARTMENT_HEAD" && <div className="space-y-1.5"><Label>{l.type === "ROLE" ? "Rol" : "Persona"}</Label><Select items={targets} value={l.target} onValueChange={(v) => setLevel(i, { target: v })}><SelectTrigger className="w-full" aria-label={`Aprobador del nivel ${i + 1}`}><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{targets.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>}
                <div className="space-y-1.5"><Label>Decisión</Label><Select items={MODE} value={l.mode} onValueChange={(v) => setLevel(i, { mode: (v ?? "ANY_ONE") as Level["mode"] })}><SelectTrigger className="w-full" aria-label={`Decisión del nivel ${i + 1}`}><SelectValue /></SelectTrigger><SelectContent>{MODE.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              {l.type === "DEPARTMENT_HEAD" && <p className="text-xs text-muted-foreground">Si el departamento no tiene jefe asignado, aprueba un administrador.</p>}
              {i > 0 && from(l, i) <= from(levels[i - 1], i - 1) && <p role="alert" className="text-xs text-destructive">Debe ser mayor que el nivel anterior.</p>}
            </li>);
        })}</ol>
        {levels.length < 5 && <Button type="button" variant="outline" onClick={() => setLevels((l) => [...l, blank()])}><Plus />Agregar nivel</Button>}
        {approvers.length === 0 && !roles.isLoading && <p className="text-sm text-destructive">Ningún rol tiene el permiso «Aprobar requisiciones». Créalo en Administración → Roles.</p>}
        <WizardFooter onBack={() => go(-1)} onNext={() => go(1)} disabled={!levelsValid} />
      </>)}

      {step === 2 && (<>
        <div className="space-y-3 rounded-xl border p-4 text-sm">
          <p className="font-medium">{name.trim()} <span className="font-normal text-muted-foreground">· {scope === "all" ? "predeterminado (todas)" : [types.length ? `tipos: ${types.map((t) => TYPES.find((x) => x.value === t)?.label).join(", ")}` : "", depts.length ? `deptos: ${depts.map((d) => departments.data?.data.find((x) => x.id === d)?.name).join(", ")}` : ""].filter(Boolean).join(" · ")}</span></p>
          <ol className="space-y-1.5">{levels.map((l, i) => <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-3 py-2"><span className="font-medium">Nivel {i + 1}</span><ArrowRight className="size-3.5 text-muted-foreground" /><span>{targetName(l)}</span><span className="text-muted-foreground">· {range(i)} · {l.mode === "ALL" ? "todos deben aprobar" : "basta uno"}</span></li>)}</ol>
        </div>
        <div className="space-y-2 rounded-xl border p-4">
          <Label htmlFor="sim" className="font-medium">Simula una requisición</Label>
          <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">Monto ({currency})</span><Input id="sim" inputMode="decimal" className="w-36" value={sim} onChange={(e) => setSim(e.target.value)} /></div>
          <p className="text-sm" aria-live="polite">{simPath.length === 0 ? "No pasa por ningún nivel: se aprueba sola." : <>Pasa por: {simPath.map(({ l, i }, k) => <span key={i}>{k > 0 && " → "}<b>Nivel {i + 1}</b> ({targetName(l)})</span>)}.</>}</p>
        </div>
        <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-medium">Otras reglas de la organización</legend>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={selfNow} onChange={(e) => setSelf(e.target.checked)} /><span>El solicitante puede aprobar sus propias requisiciones<span className="block text-xs text-muted-foreground">Recomendado desactivarlo cuando tu equipo esté dentro.</span></span></label>
          <div className="space-y-1.5"><Label>Reaprobación al editar una requisición aprobada</Label><Select items={REAPP} value={reappNow} onValueChange={(v) => setReapp(v ?? "ALWAYS")}><SelectTrigger className="w-full sm:w-72" aria-label="Reaprobación"><SelectValue /></SelectTrigger><SelectContent>{REAPP.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent></Select></div>
        </fieldset>
        <WizardFooter onBack={() => go(-1)} onNext={() => void create()} nextLabel={wfId ? "Reintentar" : "Crear flujo"} busy={busy} />
      </>)}

      {step === 3 && finished && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border p-5"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="size-4" /></span>
            <div className="space-y-1"><h2 className="text-lg font-semibold">Flujo creado</h2><p className="text-sm text-muted-foreground">«{name.trim()}» ya está activo con {levels.length} {levels.length === 1 ? "nivel" : "niveles"}. Las próximas requisiciones que se envíen pasarán por él.</p></div></div>
          <div className="flex flex-wrap gap-2"><Link href="/administracion/flujos" className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80">Ver mis flujos</Link><Link href="/requisiciones/nueva" className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm hover:bg-muted">Probar con una requisición</Link></div>
        </div>)}
    </div>
  );
}
