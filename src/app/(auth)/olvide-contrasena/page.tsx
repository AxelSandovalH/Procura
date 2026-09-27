"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

export default function OlvideContrasena() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api("/auth/password/forgot", { body: { email: email.trim() } }); setSent(true); }
    catch (err) { setError(err instanceof ApiError && err.status === 400 ? "Escribe un correo válido." : err instanceof ApiError && err.status === 429 ? "Ya pediste varios enlaces. Espera un rato antes de pedir otro; revisa también tu carpeta de spam." : "No se pudo enviar. Intenta de nuevo en unos minutos."); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Revisa tu correo</h1>
        <p role="status" className="text-sm text-muted-foreground">Si <b className="text-foreground">{email}</b> tiene cuenta, te enviamos un enlace para elegir una nueva contraseña. Puede tardar un par de minutos; revisa también spam. Abre el enlace en este mismo navegador.</p>
        <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">Volver a iniciar sesión</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Restablecer contraseña</h1>
        <p className="text-sm text-muted-foreground">Te enviaremos un enlace a tu correo.</p>
      </div>
      <div className="space-y-1.5"><Label htmlFor="email">Correo</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !email.trim()}>{busy ? "Enviando…" : "Enviar enlace"}</Button>
      <p className="text-center text-sm text-muted-foreground"><Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Volver a iniciar sesión</Link></p>
    </form>
  );
}
