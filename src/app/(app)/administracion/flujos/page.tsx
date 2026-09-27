"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/app/status-badge";
import { api, ApiError } from "@/lib/api-client";
import { money, toMinor } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Rule { id: string; level: number; condition: { min_amount_minor?: number; max_amount_minor?: number }; approver_type: string; approver_role_id: string | null; approver_membership_id: string | null; decision_mode: string }
interface Workflow { id: string; name: string; is_default: boolean; is_active: boolean; approval_rules: Rule[] }
interface Role { id: string; name: string; is_active: boolean }
interface Member { id: string; status: string; user: { full_name: string } }

export default function Flujos() {
  const qc = useQueryClient();
  const [ruleFor, setRuleFor] = useState<Workflow | null>(null);
  const wf = useQuery({ queryKey: ["workflows"], queryFn: () => api<{ data: Workflow[] }>("/organization/approval-workflows") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/organization/roles") });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<{ data: Member[] }>("/organization/members") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["workflows"] });
  const approver = (r: Rule) => r.approver_type === "ROLE" ? `Rol: ${roles.data?.data.find((x) => x.id === r.approver_role_id)?.name ?? "…"}` : r.approver_type === "MEMBERSHIP" ? `Persona: ${members.data?.data.find((x) => x.id === r.approver_membership_id)?.user.full_name ?? "…"}` : "Jefe del departamento";
  const range = (r: Rule) => { const a = r.condition.min_amount_minor, b = r.condition.max_amount_minor; return a == null && b == null ? "Cualquier monto" : `${a != null ? `desde ${money(a)}` : ""}${a != null && b != null ? " " : ""}${b != null ? `hasta ${money(b)}` : ""}`; };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Define quién aprueba una requisición según su monto. Sin flujo aplicable, se aprueba automáticamente.</p><Link href="/administracion/flujos/nuevo" className={cn(buttonVariants())}><Plus />Nuevo flujo</Link></div>
      {wf.isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> : (wf.data?.data.length ?? 0) === 0 ? <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">Aún no hay flujos de aprobación. <Link href="/administracion/flujos/nuevo" className="font-medium text-foreground underline underline-offset-4">Crea el primero con el asistente</Link>.</div> : wf.data!.data.map((w) => (
        <Card key={w.id}>
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>{w.name}</CardTitle><div className="flex items-center gap-2">{w.is_default && <StatusBadge label="Predeterminado" tone="info" />}{!w.is_active && <StatusBadge label="Inactivo" tone="muted" />}
            {!w.is_default && w.is_active && <Button size="sm" variant="ghost" onClick={async () => { await api(`/organization/approval-workflows/${w.id}`, { method: "PATCH", body: { is_default: true } }); await refresh(); }}>Hacer predeterminado</Button>}
            <Button size="sm" variant="outline" onClick={() => setRuleFor(w)}><Plus />Nivel</Button></div></div></CardHeader>
          <CardContent>{w.approval_rules.length === 0 ? <p className="text-sm text-muted-foreground">Sin niveles: las requisiciones que use este flujo se aprobarán solas.</p> : (
            <ol className="space-y-2 text-sm">{w.approval_rules.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"><span className="font-medium">Nivel {r.level}</span><span>{approver(r)}</span><span className="text-muted-foreground">{range(r)}</span><span className="text-xs text-muted-foreground">{r.decision_mode === "ALL" ? "todos deben aprobar" : "basta uno"}</span></li>)}</ol>)}</CardContent>
        </Card>))}
      {ruleFor && <RuleDialog workflow={ruleFor} roles={(roles.data?.data ?? []).filter((r) => r.is_active)} members={(members.data?.data ?? []).filter((m) => m.status === "ACTIVE")} onClose={() => setRuleFor(null)} onDone={refresh} />}
    </div>
  );
}

function RuleDialog({ workflow, roles, members, onClose, onDone }: { workflow: Workflow; roles: Role[]; members: Member[]; onClose: () => void; onDone: () => unknown }) {
  const nextLevel = Math.max(0, ...workflow.approval_rules.map((r) => r.level)) + 1;
  const [level, setLevel] = useState(String(nextLevel)); const [type, setType] = useState("ROLE"); const [target, setTarget] = useState<string | null>(null);
  const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [mode, setMode] = useState("ANY_ONE");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const typeItems = [{ value: "ROLE", label: "Un rol" }, { value: "MEMBERSHIP", label: "Una persona" }, { value: "DEPARTMENT_HEAD", label: "Jefe del departamento" }];
  const modeItems = [{ value: "ANY_ONE", label: "Basta con uno" }, { value: "ALL", label: "Todos deben aprobar" }];
  const targets = type === "ROLE" ? roles.map((r) => ({ value: r.id, label: r.name })) : members.map((m) => ({ value: m.id, label: m.user.full_name }));
  async function go() {
    setBusy(true); setError(null);
    try {
      await api(`/organization/approval-workflows/${workflow.id}/rules`, { method: "POST", body: {
        level: Number(level), approver_type: type, decision_mode: mode,
        ...(type === "ROLE" ? { approver_role_id: target } : type === "MEMBERSHIP" ? { approver_membership_id: target } : {}),
        condition: { ...(min.trim() ? { min_amount_minor: toMinor(min) } : {}), ...(max.trim() ? { max_amount_minor: toMinor(max) } : {}) } } });
      await onDone(); onClose();
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo agregar el nivel."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}><DialogContent>
      <DialogHeader><DialogTitle>Nuevo nivel · {workflow.name}</DialogTitle><DialogDescription>Los niveles se aprueban en orden. Cada uno puede aplicar solo a ciertos montos.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5"><Label htmlFor="rl-lvl">Nivel</Label><Input id="rl-lvl" type="number" min={1} value={level} onChange={(e) => setLevel(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rl-min">Desde (monto)</Label><Input id="rl-min" inputMode="decimal" placeholder="0.00" value={min} onChange={(e) => setMin(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rl-max">Hasta (monto)</Label><Input id="rl-max" inputMode="decimal" placeholder="Sin tope" value={max} onChange={(e) => setMax(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label>Aprueba</Label><Select items={typeItems} value={type} onValueChange={(v) => { setType(v ?? "ROLE"); setTarget(null); }}><SelectTrigger className="w-full" aria-label="Tipo de aprobador"><SelectValue /></SelectTrigger><SelectContent>{typeItems.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
      {type !== "DEPARTMENT_HEAD" && <div className="space-y-1.5"><Label>{type === "ROLE" ? "Rol" : "Persona"}</Label><Select items={targets} value={target} onValueChange={setTarget}><SelectTrigger className="w-full" aria-label="Aprobador"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{targets.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>}
      <div className="space-y-1.5"><Label>Decisión</Label><Select items={modeItems} value={mode} onValueChange={(v) => setMode(v ?? "ANY_ONE")}><SelectTrigger className="w-full" aria-label="Modo de decisión"><SelectValue /></SelectTrigger><SelectContent>{modeItems.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || (type !== "DEPARTMENT_HEAD" && !target)}>Agregar nivel</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}
