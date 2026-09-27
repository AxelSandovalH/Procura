"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app/page-header";
import { useSession } from "@/hooks/use-session";
import { useSyncedState } from "@/hooks/use-synced-state";
import { api, ApiError } from "@/lib/api-client";

export default function Cuenta() {
  const { me, loading } = useSession();
  const qc = useQueryClient();
  const u = me?.user;
  const [name, setName] = useSyncedState(() => u?.full_name ?? "", u?.full_name ?? "");
  const [mail, setMail] = useSyncedState(() => u?.email_notifications ?? true, String(u?.email_notifications));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading || !u) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api("/me", { method: "PATCH", body: { full_name: name.trim(), email_notifications: mail } }); await qc.invalidateQueries({ queryKey: ["me"] }); setMsg("Guardado"); }
    catch (er) { setMsg(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Mi cuenta" description="Tus datos personales y cómo quieres que te avisemos." />
      <form onSubmit={save} className="max-w-xl space-y-6">
        <Card><CardHeader><CardTitle>Perfil</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="a-name">Nombre</Label><Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} required /></div>
          <div className="space-y-1.5"><Label htmlFor="a-mail">Correo</Label><Input id="a-mail" value={u.email} readOnly disabled /><p className="text-xs text-muted-foreground">Es tu usuario para iniciar sesión.</p></div>
          <Link href="/restablecer" className="inline-block text-sm underline-offset-4 hover:underline">Cambiar contraseña</Link>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Avisos por correo</CardTitle></CardHeader><CardContent>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={mail} onChange={(e) => setMail(e.target.checked)} />
            <span>Enviarme un correo cuando pase algo que me toca<span className="block text-xs text-muted-foreground">Aprobaciones pendientes, cotizaciones recibidas, órdenes, entregas, solicitudes de relación y mensajes (uno por conversación cada 10 minutos). Lo mismo que ves en la campana, en tu correo.</span></span></label>
        </CardContent></Card>
        <div className="flex items-center gap-3"><Button type="submit" disabled={busy || name.trim().length < 2}>Guardar</Button>{msg && <span role="status" className="text-sm text-muted-foreground">{msg}</span>}</div>
      </form>
    </>
  );
}
