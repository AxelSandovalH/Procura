"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";

interface Dept { id: string; name: string; code: string | null; is_active: boolean }
interface Loc { id: string; name: string; code: string | null; contact_name: string | null; contact_phone: string | null; is_delivery_point: boolean; is_active: boolean }

export default function Estructura() {
  const session = useSession();
  const [dlg, setDlg] = useState<"dept" | "loc" | null>(null);
  const depts = useQuery({ queryKey: ["departments"], queryFn: () => api<{ data: Dept[] }>("/organization/departments"), enabled: session.can("department.manage") });
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api<{ data: Loc[] }>("/organization/locations"), enabled: session.can("location.manage") });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {session.can("department.manage") && (
        <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Departamentos</CardTitle><Button size="sm" variant="outline" onClick={() => setDlg("dept")}><Plus />Nuevo</Button></div></CardHeader>
          <CardContent>{depts.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : (depts.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Sin departamentos.</p> :
            <ul className="divide-y text-sm">{depts.data!.data.map((d) => <li key={d.id} className="flex items-center justify-between py-2"><span className="font-medium">{d.name}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{d.code}{!d.is_active && <StatusBadge label="Inactivo" tone="muted" />}</span></li>)}</ul>}</CardContent></Card>)}
      {session.can("location.manage") && (
        <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Ubicaciones</CardTitle><Button size="sm" variant="outline" onClick={() => setDlg("loc")}><Plus />Nueva</Button></div></CardHeader>
          <CardContent>{locs.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : (locs.data?.data.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Sin ubicaciones.</p> :
            <ul className="divide-y text-sm">{locs.data!.data.map((l) => <li key={l.id} className="flex items-center justify-between py-2"><div><span className="font-medium">{l.name}</span>{l.contact_name && <span className="block text-xs text-muted-foreground">{l.contact_name}{l.contact_phone ? ` · ${l.contact_phone}` : ""}</span>}</div><span className="flex items-center gap-2 text-xs text-muted-foreground">{l.code}{l.is_delivery_point && <StatusBadge label="Punto de entrega" tone="info" />}</span></li>)}</ul>}</CardContent></Card>)}
      {dlg && <SimpleDialog kind={dlg} onClose={() => setDlg(null)} />}
    </div>
  );
}

function SimpleDialog({ kind, onClose }: { kind: "dept" | "loc"; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", code: "", contact_name: "", contact_phone: "", delivery: true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (kind === "dept") await api("/organization/departments", { method: "POST", body: { name: f.name.trim(), code: f.code.trim() || undefined } });
      else await api("/organization/locations", { method: "POST", body: { name: f.name.trim(), code: f.code.trim() || undefined, contact_name: f.contact_name.trim() || undefined, contact_phone: f.contact_phone.trim() || undefined, is_delivery_point: f.delivery } });
      await qc.invalidateQueries({ queryKey: [kind === "dept" ? "departments" : "locations"] }); onClose();
    } catch (er) { setError(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}><DialogContent>
      <DialogHeader><DialogTitle>{kind === "dept" ? "Nuevo departamento" : "Nueva ubicación"}</DialogTitle><DialogDescription>{kind === "dept" ? "Sirve para asignar roles y flujos de aprobación por área." : "Sirve para recepciones y roles por sede."}</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={go}>
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <div className="space-y-1.5"><Label htmlFor="s-name">Nombre *</Label><Input id="s-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-code">Código</Label><Input id="s-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        </div>
        {kind === "loc" && <>
          <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="s-cn">Contacto</Label><Input id="s-cn" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="s-cp">Teléfono</Label><Input id="s-cp" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.checked })} />Es punto de entrega</label></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy || !f.name.trim()}>Guardar</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  );
}
