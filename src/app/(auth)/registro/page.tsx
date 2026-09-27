"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

function RegistroForm() {
  const rawNext = useSearchParams().get("next");
  const loginHref = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? `/login?next=${encodeURIComponent(rawNext)}` : "/login";
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ confirm: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ email_confirmation_required: boolean }>("/auth/register", { body: { ...form, next: rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : undefined } });
      setDone({ confirm: r.email_confirmation_required });
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors[0]?.message ?? err.detail ?? err.title) : "No se pudo crear la cuenta.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{done.confirm ? "Revisa tu correo" : "Cuenta creada"}</h1>
        <p className="text-sm text-muted-foreground">{done.confirm ? `Te enviamos un enlace de confirmación a ${form.email}. Al confirmarlo podrás iniciar sesión.` : "Ya puedes iniciar sesión."}</p>
        <Link href={loginHref} className="text-sm font-medium underline-offset-4 hover:underline">Ir a iniciar sesión</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Crear cuenta</h1>
        <p className="text-sm text-muted-foreground">Después podrás crear tu organización o unirte a una.</p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="name">Nombre completo</Label><Input id="name" required minLength={2} autoComplete="name" value={form.full_name} onChange={set("full_name")} /></div>
        <div className="space-y-1.5"><Label htmlFor="email">Correo</Label><Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></div>
        <div className="space-y-1.5"><Label htmlFor="password">Contraseña</Label><Input id="password" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set("password")} /><p className="text-xs text-muted-foreground">Mínimo 10 caracteres.</p></div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Creando…" : "Crear cuenta"}</Button>
      <p className="text-center text-sm text-muted-foreground">¿Ya tienes cuenta? <Link href={loginHref} className="font-medium text-foreground underline-offset-4 hover:underline">Inicia sesión</Link></p>
    </form>
  );
}

export default function RegistroPage() {
  return <Suspense><RegistroForm /></Suspense>;
}
