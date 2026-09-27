"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface Preview { kind: "MEMBERSHIP" | "RELATIONSHIP"; organization: { id: string; display_name: string }; relationship_position: "BUYER" | "SUPPLIER" | null; role_names: string[]; usable: boolean; reason: string | null }
const REASON: Record<string, string> = { expired: "La invitación venció.", revoked: "La invitación fue revocada.", exhausted: "La invitación ya alcanzó su límite de usos." };

export default function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const session = useSession();
  const inv = useQuery({ queryKey: ["invitation", token], queryFn: () => api<Preview>(`/invitations/${token}`), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOrg, setAsOrg] = useState<string | null>(null);

  async function accept() {
    setBusy(true); setError(null);
    try {
      await api(`/invitations/${token}/accept`, { method: "POST", body: inv.data?.kind === "RELATIONSHIP" ? { organization_id: asOrg ?? session.org?.id } : {} });
      window.location.assign(inv.data?.kind === "RELATIONSHIP" ? "/relaciones" : "/inicio");
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo aceptar."); setBusy(false); }
  }
  const p = inv.data;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Logo size={24} textClassName="text-lg" />
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Invitación a Procura</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {inv.isLoading ? <div className="h-20 animate-pulse rounded bg-muted" /> : !p ? <p>Esta invitación no es válida.</p> : (<>
            <p>{p.kind === "MEMBERSHIP" ? <>Te invitaron a unirte a <b>{p.organization.display_name}</b>{p.role_names.length > 0 && <> con el rol {p.role_names.join(", ")}</>}.</> : <><b>{p.organization.display_name}</b> quiere establecer una relación contigo como {p.relationship_position === "BUYER" ? "su proveedor" : "su cliente"}.</>}</p>
            {!p.usable && <p role="alert" className="rounded-lg bg-muted px-3 py-2">{REASON[p.reason ?? ""] ?? "La invitación ya no está disponible."}</p>}
            {p.usable && p.kind === "RELATIONSHIP" && session.memberships.length > 1 && (
              <label className="block space-y-1.5"><span className="text-muted-foreground">Aceptar con la organización</span>
                <select className="h-8 w-full rounded-lg border bg-transparent px-2" value={asOrg ?? session.org?.id ?? ""} onChange={(e) => setAsOrg(e.target.value)}>{session.memberships.map((m) => <option key={m.organization.id} value={m.organization.id}>{m.organization.display_name}</option>)}</select></label>)}
            {error && <p role="alert" className="text-destructive">{error}</p>}
            <div className="flex gap-2"><Button onClick={accept} disabled={busy || !p.usable}>{busy ? "Aceptando…" : "Aceptar invitación"}</Button><Link href="/inicio" className="inline-flex h-8 items-center rounded-lg border px-2.5 hover:bg-muted">Ahora no</Link></div>
          </>)}
        </CardContent>
      </Card>
    </main>
  );
}
