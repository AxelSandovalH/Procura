"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { PERMISSION_GROUPS } from "@/lib/ui/permissions";

interface Role { id: string; name: string; description: string | null; is_system: boolean; is_active: boolean; permission_codes: string[] }

export default function Roles() {
  const session = useSession();
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ data: Role[] }>("/organization/roles"), enabled: session.can("role.read") });
  const canManage = session.can("role.manage");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Un rol es un conjunto de permisos. Se asigna a cada persona, con alcance a toda la organización, un departamento o una ubicación.</p>
        {canManage && <Button onClick={() => setEditing("new")}><Plus />Nuevo rol</Button>}</div>
      {roles.isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> : (
        <div className="grid gap-3 sm:grid-cols-2">{(roles.data?.data ?? []).map((r) => (
          <Card key={r.id} className={r.is_active ? "" : "text-muted-foreground"}>
            <CardHeader><div className="flex items-start justify-between gap-2"><CardTitle>{r.name}</CardTitle>
              <div className="flex items-center gap-1.5">{r.is_system && <StatusBadge label="Base" tone="muted" />}{!r.is_active && <StatusBadge label="Inactivo" tone="warn" />}{canManage && <Button size="icon-sm" variant="ghost" aria-label={`Editar ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button>}</div></div></CardHeader>
            <CardContent className="space-y-1 text-sm">{r.description && <p className="text-muted-foreground">{r.description}</p>}<p className="text-xs text-muted-foreground">{r.permission_codes.length} permisos</p></CardContent>
          </Card>))}</div>)}
      {editing && <RoleDialog role={editing === "new" ? null : editing} myPermissions={session.can} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RoleDialog({ role, myPermissions, onClose }: { role: Role | null; myPermissions: (p: string) => boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? ""); const [description, setDescription] = useState(role?.description ?? "");
  const [active, setActive] = useState(role?.is_active ?? true);
  const [codes, setCodes] = useState<Set<string>>(new Set(role?.permission_codes ?? []));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const toggle = (c: string) => setCodes((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  async function go() {
    setBusy(true); setError(null);
    const body = { name: name.trim(), description: description.trim() || (role ? null : undefined), permission_codes: [...codes] };
    try {
      if (role) await api(`/organization/roles/${role.id}`, { method: "PATCH", body: { ...body, is_active: active } });
      else await api("/organization/roles", { method: "POST", body });
      await qc.invalidateQueries({ queryKey: ["roles"] }); onClose();
    } catch (e) { setError(e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.detail ?? e.title) : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{role ? `Editar rol: ${role.name}` : "Nuevo rol"}</DialogTitle><DialogDescription>Marca los permisos que otorga. Los cambios aplican a todas las personas con este rol.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="r-name">Nombre *</Label><Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-desc">Descripción</Label><Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        {role && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Activo</label>}
        <div className="space-y-4">{PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.title}><legend className="mb-1.5 text-sm font-medium">{g.title}</legend>
            <div className="grid gap-1 sm:grid-cols-2">{Object.entries(g.items).map(([code, label]) => (
              <label key={code} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={codes.has(code)} onChange={() => toggle(code)} /><span>{label}{!myPermissions(code) && <span className="block text-xs text-muted-foreground">Tú no lo tienes: no podrás asignar este rol</span>}</span></label>))}</div>
          </fieldset>))}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || name.trim().length === 0}>{busy ? "Guardando…" : "Guardar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
