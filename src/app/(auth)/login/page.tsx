"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const badLink = params.get("enlace") === "invalido";
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/auth/login", { body: { email, password } });
      qc.clear();
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/inicio");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Correo o contraseña incorrectos, o el correo aún no está confirmado." : "No se pudo iniciar sesión. Intenta de nuevo.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
        <p className="text-sm text-muted-foreground">Entra a tu cuenta de Procura.</p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="email">Correo</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-1.5"><div className="flex items-center justify-between"><Label htmlFor="password">Contraseña</Label><Link href="/olvide-contrasena" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">¿Olvidaste tu contraseña?</Link></div><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      </div>
      {badLink && !error && <p role="alert" className="text-sm text-destructive">El enlace del correo venció o se abrió en otro navegador. Inicia sesión o pide uno nuevo.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
      <p className="text-center text-sm text-muted-foreground">¿No tienes cuenta? <Link href={next && next.startsWith("/") && !next.startsWith("//") ? `/registro?next=${encodeURIComponent(next)}` : "/registro"} className="font-medium text-foreground underline-offset-4 hover:underline">Regístrate</Link></p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
