"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

/** Elegir contraseña nueva. Requiere sesión: la abre el enlace del correo (/auth/callback) o la de un usuario ya dentro. */
export default function Restablecer() {
  // Sin sesión /me da 401 y api-client redirigiría a /login: aquí se consulta con fetch directo para mostrar un mensaje propio.
  const me = useQuery({ queryKey: ["reset-session"], queryFn: async () => (await fetch("/api/v1/me", { credentials: "same-origin" })).ok, retry: false });
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false);
  const mismatch = p2.length > 0 && p1 !== p2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1 !== p2) return;
    setBusy(true); setError(null);
    try { await api("/auth/password/reset", { body: { password: p1 } }); setDone(true); }
    catch (err) { setError(err instanceof ApiError ? (err.fieldErrors[0]?.message ?? err.detail ?? err.title) : "No se pudo cambiar la contraseña."); }
    finally { setBusy(false); }
  }

  if (me.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  if (!me.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Enlace no válido</h1>
        <p role="alert" className="text-sm text-muted-foreground">El enlace venció, ya se usó o se abrió en otro navegador. Pide uno nuevo y ábrelo en el mismo navegador donde lo solicitaste.</p>
        <Link href="/olvide-contrasena" className="text-sm font-medium underline-offset-4 hover:underline">Pedir un enlace nuevo</Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Contraseña actualizada</h1>
        <p role="status" className="text-sm text-muted-foreground">Ya puedes seguir usando Procura con tu nueva contraseña.</p>
        <Link href="/inicio" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80">Ir a Procura</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Nueva contraseña</h1>
        <p className="text-sm text-muted-foreground">Elige una contraseña de al menos 10 caracteres.</p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="p1">Contraseña nueva</Label><Input id="p1" type="password" autoComplete="new-password" required minLength={10} value={p1} onChange={(e) => setP1(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="p2">Repite la contraseña</Label><Input id="p2" type="password" autoComplete="new-password" required aria-invalid={mismatch} value={p2} onChange={(e) => setP2(e.target.value)} />{mismatch && <p className="text-xs text-destructive">No coinciden.</p>}</div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy || p1.length < 10 || p1 !== p2}>{busy ? "Guardando…" : "Guardar contraseña"}</Button>
    </form>
  );
}
