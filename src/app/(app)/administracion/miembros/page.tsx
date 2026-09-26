"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MoreHorizontal, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionDialog } from "@/components/app/action-dialog";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort } from "@/lib/format";
import type { Tone } from "@/lib/ui/status";

interface Assignment { id: string; role: { id: string; name: string }; scope_type: string; scope_id: string | null }
interface Member { id: string; status: string; is_primary_admin: boolean; title: string | null; created_at: string; user: { id: string; email: string; full_name: string }; role_assignments: Assignment[] }
interface Role { id: string; name: string; is_active: boolean }
interface Named { id: string; name: string }
interface Invitation { id: string; kind: string; email: string | null; relationship_position: string | null; expires_at: string; max_uses: number; used_count: number; status: string }

const MEMBER_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Activo", tone: "ok" }, PENDING: { label: "Pendiente", tone: "warn" }, SUSPENDED: { label: "Suspendido", tone: "warn" },
  REJECTED: { label: "Rechazado", tone: "bad" }, REMOVED: { label: "Removido", tone: "muted" }, INVITED: { label: "Invitado", tone: "info" },
};
const INV_STATUS: Record<string, { label: string; tone: Tone }> = { EXHAUSTED: { label: "Agotada", tone: "muted" }, ACTIVE: { label: "Vigente", tone: "ok" }, EXPIRED: { label: "Vencida", tone: "muted" }, REVOKED: { label: "Revocada", tone: "bad" } };
/** El estado guardado sigue ACTIVE aunque la invitación ya no sirva: se deriva por vigencia y usos. */
const invState = (i: Invitation) => (i.status !== "ACTIVE" ? i.status : new Date(i.expires_at) <= new Date() ? "EXPIRED" : i.used_count >= i.max_uses ? "EXHAUSTED" : "ACTIVE");
type Dlg = { kind: "reject" | "suspend" | "remove" | "transfer"; m: Member } | { kind: "assign"; m: Member } | null;

export default function Miembros() {
  const session = useSession();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<{ data: Member[] }>("/organization/members"), enabled: session.can("member.read") });
  const invites = useQuery({ queryKey: ["invitations"], queryFn: () => api<{ data: Invitation[] }>("/organization/invitations"), enabled: session.can("member.invite") });
  const refresh = () => Promise.all(["members", "invitations"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const canManage = session.can("member.manage"), canApprove = session.can("member.approve"), canAssign = session.can("role.assign");
  const rows = (members.data?.data ?? []).filter((m) => !["REMOVED"].includes(m.status));

  async function simple(m: Member, path: string) {
    setError(null);
    try { await api(`/organization/members/${m.id}/${path}`, { method: "POST", body: {} }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo completar la acción."); }
  }
  const withReason = (m: Member, path: string) => async (c: string) => { await api(`/organization/members/${m.id}/${path}`, { method: "POST", body: { reason: c || undefined } }); await refresh(); };
  async function unassign(m: Member, a: Assignment) {
    setError(null);
    try { await api(`/organization/members/${m.id}/role-assignments/${a.id}`, { method: "DELETE" }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo quitar el rol."); }
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Miembros</CardTitle>{session.can("member.invite") && <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus />Invitar</Button>}</div></CardHeader>
        <CardContent className="px-0">
          {members.isLoading ? <div className="mx-4 h-24 animate-pulse rounded bg-muted" /> : (
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Persona</TableHead><TableHead>Roles</TableHead><TableHead>Estado</TableHead><TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((m) => {
                const st = MEMBER_STATUS[m.status] ?? { label: m.status, tone: "neutral" as const };
                const isMe = m.id === session.me?.memberships.find((x) => x.organization.id === session.org?.id)?.id;
                return (
                  <TableRow key={m.id}>
                    <TableCell><div className="font-medium">{m.user.full_name}{isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(tú)</span>}{m.is_primary_admin && <StatusBadge className="ml-2" label="Administrador principal" tone="info" />}</div><div className="text-xs text-muted-foreground">{m.user.email}</div></TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{m.role_assignments.length === 0 ? <span className="text-xs text-muted-foreground">Sin roles</span> : m.role_assignments.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">{a.role.name}{a.scope_type !== "ORGANIZATION" && <span className="text-muted-foreground">· {a.scope_type === "DEPARTMENT" ? "depto." : "ubic."}</span>}
                        {canAssign && <button type="button" aria-label={`Quitar rol ${a.role.name} a ${m.user.full_name}`} className="rounded-full hover:bg-background" onClick={() => void unassign(m, a)}><X className="size-3" /></button>}</span>))}</div></TableCell>
                    <TableCell><StatusBadge {...st} /></TableCell>
                    <TableCell>{(canManage || canApprove || canAssign) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${m.user.full_name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52"><DropdownMenuGroup>
                          {m.status === "PENDING" && canApprove && <><DropdownMenuItem onClick={() => void simple(m, "approve")}>Aprobar ingreso</DropdownMenuItem><DropdownMenuItem onClick={() => setDlg({ kind: "reject", m })}>Rechazar</DropdownMenuItem></>}
                          {m.status === "ACTIVE" && canAssign && <DropdownMenuItem onClick={() => setDlg({ kind: "assign", m })}>Asignar rol…</DropdownMenuItem>}
                          {m.status === "ACTIVE" && canManage && !m.is_primary_admin && <DropdownMenuItem onClick={() => setDlg({ kind: "suspend", m })}>Suspender</DropdownMenuItem>}
                          {m.status === "SUSPENDED" && canManage && <DropdownMenuItem onClick={() => void simple(m, "reactivate")}>Reactivar</DropdownMenuItem>}
                          {m.status === "ACTIVE" && !m.is_primary_admin && session.can("admin.transfer_primary") && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setDlg({ kind: "transfer", m })}>Hacer administrador principal</DropdownMenuItem></>}
                          {["ACTIVE", "SUSPENDED"].includes(m.status) && canManage && !m.is_primary_admin && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDlg({ kind: "remove", m })}>Quitar de la organización</DropdownMenuItem></>}
                        </DropdownMenuGroup></DropdownMenuContent>
                      </DropdownMenu>)}</TableCell>
                  </TableRow>);
              })}</TableBody>
            </Table></div>)}
        </CardContent>
      </Card>

      {session.can("member.invite") && (
        <Card><CardHeader><CardTitle>Invitaciones</CardTitle></CardHeader><CardContent className="px-0">
          {(invites.data?.data.length ?? 0) === 0 ? <p className="px-4 text-sm text-muted-foreground">Sin invitaciones.</p> : (
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Para</TableHead><TableHead>Usos</TableHead><TableHead>Vence</TableHead><TableHead>Estado</TableHead><TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader>
              <TableBody>{invites.data!.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.kind === "MEMBERSHIP" ? "Miembro" : i.relationship_position === "SUPPLIER" ? "Proveedor" : "Cliente"}</TableCell>
                  <TableCell className="text-muted-foreground">{i.email ?? "Cualquiera con el enlace"}</TableCell>
                  <TableCell className="tabular-nums">{i.used_count}/{i.max_uses}</TableCell><TableCell>{dateShort(i.expires_at)}</TableCell>
                  <TableCell><StatusBadge {...(INV_STATUS[invState(i)] ?? { label: i.status, tone: "neutral" as const })} /></TableCell>
                  <TableCell>{invState(i) === "ACTIVE" && <Button size="icon-sm" variant="ghost" aria-label="Revocar invitación" onClick={async () => { await api(`/organization/invitations/${i.id}`, { method: "DELETE" }); await refresh(); }}><X /></Button>}</TableCell>
                </TableRow>))}</TableBody>
            </Table></div>)}
        </CardContent></Card>)}

      {dlg && dlg.kind !== "assign" && (
        <ActionDialog open onOpenChange={(o) => !o && setDlg(null)}
          title={{ reject: "Rechazar solicitud", suspend: "Suspender miembro", remove: "Quitar de la organización", transfer: "Transferir administración principal" }[dlg.kind]}
          description={dlg.kind === "transfer" ? `${dlg.m.user.full_name} será el administrador principal y tú dejarás de serlo.` : dlg.m.user.full_name}
          fieldLabel="Motivo" destructive={dlg.kind !== "transfer"} confirmLabel="Confirmar"
          onConfirm={withReason(dlg.m, dlg.kind === "transfer" ? "transfer-primary-admin" : dlg.kind)} />)}
      {dlg?.kind === "assign" && <AssignRoleDialog member={dlg.m} onClose={() => setDlg(null)} onDone={refresh} />}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onDone={refresh} />
    </div>
  );
}

function AssignRoleDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => unknown }) {
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/organization/roles") });
  const depts = useQuery({ queryKey: ["departments"], queryFn: () => api<{ data: Named[] }>("/organization/departments") });
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api<{ data: Named[] }>("/organization/locations") });
  const [roleId, setRoleId] = useState<string | null>(null);
  const [scope, setScope] = useState("ORGANIZATION");
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const roleItems = (roles.data?.data ?? []).filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name }));
  const scopeItems = [{ value: "ORGANIZATION", label: "Toda la organización" }, { value: "DEPARTMENT", label: "Un departamento" }, { value: "LOCATION", label: "Una ubicación" }];
  const targetItems = (scope === "DEPARTMENT" ? depts.data?.data : locs.data?.data ?? []) ?? [];
  const targetOpts = targetItems.map((t) => ({ value: t.id, label: t.name }));
  async function go() {
    setBusy(true); setError(null);
    try { await api(`/organization/members/${member.id}/role-assignments`, { method: "POST", body: { role_id: roleId, scope_type: scope, scope_id: scope === "ORGANIZATION" ? undefined : scopeId } }); await onDone(); onClose(); }
    catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo asignar."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}><DialogContent>
      <DialogHeader><DialogTitle>Asignar rol</DialogTitle><DialogDescription>{member.user.full_name}. Solo puedes asignar roles cuyos permisos tú también tienes.</DialogDescription></DialogHeader>
      <div className="space-y-1.5"><Label>Rol</Label><Select items={roleItems} value={roleId} onValueChange={setRoleId}><SelectTrigger className="w-full" aria-label="Rol"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{roleItems.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Alcance</Label><Select items={scopeItems} value={scope} onValueChange={(v) => { setScope(v ?? "ORGANIZATION"); setScopeId(null); }}><SelectTrigger className="w-full" aria-label="Alcance"><SelectValue /></SelectTrigger><SelectContent>{scopeItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
      {scope !== "ORGANIZATION" && <div className="space-y-1.5"><Label>{scope === "DEPARTMENT" ? "Departamento" : "Ubicación"}</Label><Select items={targetOpts} value={scopeId} onValueChange={setScopeId}><SelectTrigger className="w-full" aria-label="Destino del alcance"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{targetOpts.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || !roleId || (scope !== "ORGANIZATION" && !scopeId)}>Asignar</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function InviteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => unknown }) {
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/organization/roles"), enabled: open });
  const [email, setEmail] = useState(""); const [picked, setPicked] = useState<string[]>([]); const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [link, setLink] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  function close() { onOpenChange(false); setLink(null); setEmail(""); setPicked([]); setCopied(false); setError(null); }
  async function go() {
    setBusy(true); setError(null);
    try { const r = await api<{ url: string }>("/organization/invitations", { method: "POST", body: { kind: "MEMBERSHIP", email: email.trim() || undefined, role_ids: picked, expires_in_days: Number(days) || 7 } }); setLink(r.url); await onDone(); }
    catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo crear la invitación."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy && !o) close(); }}><DialogContent>
      {link ? (<>
        <DialogHeader><DialogTitle>Invitación creada</DialogTitle><DialogDescription>Comparte este enlace. No se vuelve a mostrar completo.</DialogDescription></DialogHeader>
        <div className="flex gap-2"><Input readOnly aria-label="Enlace de invitación" value={link} onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={async () => { await navigator.clipboard?.writeText(link); setCopied(true); }}><Copy />{copied ? "Copiado" : "Copiar"}</Button></div>
        <DialogFooter><Button onClick={close}>Listo</Button></DialogFooter>
      </>) : (<>
        <DialogHeader><DialogTitle>Invitar a la organización</DialogTitle><DialogDescription>Quien acepte el enlace entra con los roles que elijas.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="inv-email">Correo (opcional)</Label><Input id="inv-email" type="email" placeholder="Si lo indicas, solo esa persona puede aceptar" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Roles</legend>
          {(roles.data?.data ?? []).filter((r) => r.is_active).map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />{r.name}</label>)}</fieldset>
        <div className="space-y-1.5"><Label htmlFor="inv-days">Vigencia (días)</Label><Input id="inv-days" type="number" min={1} max={90} className="w-28" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={close} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy}><Plus />Crear invitación</Button></DialogFooter>
      </>)}
    </DialogContent></Dialog>
  );
}
