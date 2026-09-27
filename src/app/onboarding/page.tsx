"use client";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export default function OnboardingPage() {
  const { memberships } = useSession();
  const [name, setName] = useState("");
  const [legal, setLegal] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/organizations", { body: { display_name: name, legal_name: legal || name, slug } });
      const n = new URLSearchParams(window.location.search).get("next");
      window.location.assign(n && n.startsWith("/") && !n.startsWith("//") ? n : "/inicio");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors[0]?.message ?? err.detail ?? err.title) : "No se pudo crear la organización.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-5">
        <Logo size={24} textClassName="text-lg" />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Crea tu organización</h1>
          <p className="text-sm text-muted-foreground">Serás su administrador principal. Podrás invitar a tu equipo y conectar con proveedores y clientes después.</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="name">Nombre comercial</Label><Input id="name" required value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} placeholder="Papillon Yachts" /></div>
          <div className="space-y-1.5"><Label htmlFor="legal">Razón social <span className="text-muted-foreground">(opcional)</span></Label><Input id="legal" value={legal} onChange={(e) => setLegal(e.target.value)} placeholder="Papillon Yachts SA de CV" /></div>
          <div className="space-y-1.5"><Label htmlFor="slug">Dirección en Procura</Label>
            <div className="flex items-center rounded-lg border border-input text-sm focus-within:ring-3 focus-within:ring-ring/50"><span className="pl-2.5 text-muted-foreground">procura.app/</span><input id="slug" required minLength={3} value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} className="h-8 flex-1 bg-transparent px-1 outline-none" /></div>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || slug.length < 3}>{busy ? "Creando…" : "Crear organización"}</Button>
        {memberships.length > 0 && <p className="text-center text-sm"><Link href="/inicio" className="text-muted-foreground underline-offset-4 hover:underline">Volver</Link></p>}
      </form>
    </main>
  );
}
