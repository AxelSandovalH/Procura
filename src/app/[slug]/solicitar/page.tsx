"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Circle } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

interface Portal { portal: { slug: string; display_name: string; welcome_text: string | null; organization_id: string }; viewer: { authenticated: boolean; organization?: { id: string } | null; relationship?: { id: string; status: string } | null; is_own_portal?: boolean; can_request?: boolean; can_join?: boolean } }

/** Portal público de un proveedor. Nunca hay requisiciones anónimas: login → organización → relación → solicitar. */
export default function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal", slug], queryFn: () => api<Portal>(`/portal/${encodeURIComponent(slug)}`), retry: false });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = `/${slug}/solicitar`;
  const next = encodeURIComponent(here);

  async function join() {
    setBusy(true); setError(null);
    try { await api(`/portal/${encodeURIComponent(slug)}/join`, { method: "POST", body: { message: message.trim() || undefined } }); await qc.invalidateQueries({ queryKey: ["portal", slug] }); }
    catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo enviar la solicitud."); }
    finally { setBusy(false); }
  }

  const p = q.data?.portal, v = q.data?.viewer;
  // Paso actual: 0 sesión, 1 organización, 2 relación aprobada, 3 solicitar
  const step = !v?.authenticated ? 0 : !v.organization ? 1 : v.relationship?.status === "ACTIVE" ? 3 : 2;
  const steps = ["Inicia sesión", "Tu organización", "Aprobación del proveedor", "Solicita"];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-4">
      <Link href="/" aria-label="Procura"><Logo size={22} textClassName="text-lg" /></Link>
      {q.isLoading ? <div className="h-48 animate-pulse rounded-xl bg-muted" /> : !p ? (
        <Card><CardHeader><CardTitle>Portal no disponible</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Este enlace no existe o el portal está desactivado. Verifica la dirección con tu proveedor.</CardContent></Card>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Building2 className="size-4" />Portal de solicitudes</div>
            <h1 className="text-3xl font-semibold tracking-tight">{p.display_name}</h1>
            {p.welcome_text && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.welcome_text}</p>}
          </div>

          {!v?.is_own_portal && (
            <ol className="grid grid-cols-4 gap-2 text-xs" aria-label="Progreso">{steps.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={`flex flex-col gap-1 border-t-2 pt-2 ${i < step ? "border-primary" : i === step ? "border-primary font-medium" : "border-border text-muted-foreground"}`}>
                <span className="flex items-center gap-1">{i < step ? <Check className="size-3" /> : <Circle className="size-3" />}{i + 1}</span>{s}
              </li>))}</ol>)}

          <Card><CardContent className="space-y-4 pt-4 text-sm">
            {v?.is_own_portal ? (<>
              <p>Este es el portal de tu propia organización. Así lo ven tus clientes.</p>
              <Link href="/administracion/organizacion" className="inline-flex h-8 items-center rounded-lg border px-2.5 hover:bg-muted">Editar texto de bienvenida</Link>
            </>) : !v?.authenticated ? (<>
              <p>Para enviar una solicitud a {p.display_name} necesitas una cuenta. Nadie puede solicitar de forma anónima.</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/login?next=${next}`} className="inline-flex h-9 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/80">Iniciar sesión</Link>
                <Link href={`/registro?next=${next}`} className="inline-flex h-9 items-center rounded-lg border px-3 hover:bg-muted">Crear cuenta</Link>
              </div>
            </>) : !v.organization ? (<>
              <p>Ya tienes sesión. Falta registrar la organización que hará la compra.</p>
              <Link href={`/onboarding?next=${next}`} className="inline-flex h-9 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/80">Crear mi organización</Link>
            </>) : v.relationship?.status === "ACTIVE" ? (<>
              <p>Tu organización ya trabaja con {p.display_name}. Crea una requisición y se les enviará automáticamente para cotizar en cuanto se apruebe.</p>
              {v.can_request ? <Link href={`/requisiciones/nueva?proveedor=${p.organization_id}&nombre=${encodeURIComponent(p.display_name)}`} className="inline-flex h-9 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/80">Crear requisición</Link>
                : <p className="rounded-lg bg-muted px-3 py-2">Tu rol no permite crear requisiciones. Pide a tu administrador el permiso correspondiente.</p>}
            </>) : v.relationship?.status === "PENDING" ? (
              <p role="status" className="rounded-lg bg-muted px-3 py-2">Tu solicitud fue enviada. {p.display_name} debe aprobarla; te avisaremos en tus notificaciones.</p>
            ) : v.relationship?.status === "SUSPENDED" ? (
              <p role="alert" className="rounded-lg bg-muted px-3 py-2">Tu relación con {p.display_name} está suspendida. Contáctalos directamente.</p>
            ) : v.can_join ? (<>
              <p>Primero {p.display_name} debe aceptar trabajar con tu organización.</p>
              <div className="space-y-1.5"><Label htmlFor="pm">Mensaje (opcional)</Label><Textarea id="pm" rows={3} placeholder="Quiénes son y qué necesitan" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} /></div>
              {error && <p role="alert" className="text-destructive">{error}</p>}
              <Button onClick={join} disabled={busy}>{busy ? "Enviando…" : "Solicitar relación"}</Button>
            </>) : (
              <p className="rounded-lg bg-muted px-3 py-2">Tu rol no permite solicitar relaciones. Pide a tu administrador que lo haga.</p>
            )}
          </CardContent></Card>
          {v?.authenticated && !v.is_own_portal && <p className="text-xs text-muted-foreground">Actuando como la organización activa. <Link href="/inicio" className="underline">Ir a mi cuenta</Link></p>}
        </>
      )}
    </main>
  );
}
