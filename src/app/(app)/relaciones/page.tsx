"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { dateShort } from "@/lib/format";
import { RELATIONSHIP_STATUS } from "@/lib/ui/status";

interface Rel { id: string; status: string; position: "BUYER" | "SUPPLIER"; buyer: { display_name: string }; supplier: { display_name: string }; created_at: string; accepted_at: string | null }
interface Org { id: string; slug: string; display_name: string; country: string | null }

export default function Relaciones() {
  const session = useSession();
  const [tab, setTab] = useState("SUPPLIER_OF_ME");
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["relationships"], queryFn: () => api<{ data: Rel[] }>("/relationships") });
  // position = mi lado. Mis proveedores: yo soy BUYER. Mis clientes: yo soy SUPPLIER.
  const rows = (q.data?.data ?? []).filter((r) => (tab === "SUPPLIER_OF_ME" ? r.position === "BUYER" : r.position === "SUPPLIER"));
  return (
    <>
      <PageHeader title="Relaciones" description="Con quién compras y a quién le vendes. Toda cotización y orden viaja por una relación activa."
        actions={session.can("relationship.request") ? <Button onClick={() => setOpen(true)}><Plus />Nueva relación</Button> : undefined} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="mb-4">
        <TabsList><TabsTrigger value="SUPPLIER_OF_ME">Mis proveedores</TabsTrigger><TabsTrigger value="CLIENT_OF_ME">Mis clientes</TabsTrigger></TabsList>
      </Tabs>
      {q.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">{tab === "SUPPLIER_OF_ME" ? "Aún no tienes proveedores." : "Aún no tienes clientes."}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Organización</TableHead><TableHead>Estado</TableHead><TableHead>Desde</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Link href={`/relaciones/${r.id}`} className="font-medium hover:underline">{r.position === "BUYER" ? r.supplier.display_name : r.buyer.display_name}</Link></TableCell>
              <TableCell><StatusBadge {...(RELATIONSHIP_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const })} /></TableCell>
              <TableCell className="text-muted-foreground">{dateShort(r.accepted_at ?? r.created_at)}</TableCell>
            </TableRow>))}</TableBody>
        </Table></div>
      )}
      <NewRelationship open={open} onOpenChange={setOpen} defaultPosition={tab === "SUPPLIER_OF_ME" ? "BUYER" : "SUPPLIER"} />
    </>
  );
}

function NewRelationship({ open, onOpenChange, defaultPosition }: { open: boolean; onOpenChange: (o: boolean) => void; defaultPosition: "BUYER" | "SUPPLIER" }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Org[] | null>(null);
  const [picked, setPicked] = useState<Org | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null); setPicked(null);
    try { setResults((await api<{ data: Org[] }>(`/organizations/search?q=${encodeURIComponent(term.trim())}`)).data); }
    catch (e) { setResults(null); setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo buscar."); }
  }
  async function go() {
    setBusy(true); setError(null);
    try {
      await api("/relationships", { method: "POST", body: { counterpart_organization_id: picked!.id, my_position: defaultPosition, message: message.trim() || undefined } });
      await qc.invalidateQueries({ queryKey: ["relationships"] });
      setPicked(null); setResults(null); setTerm(""); setMessage(""); onOpenChange(false);
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.title) : "No se pudo enviar la solicitud."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{defaultPosition === "BUYER" ? "Agregar proveedor" : "Agregar cliente"}</DialogTitle><DialogDescription>Solo aparecen organizaciones que decidieron ser encontradas. La otra parte debe aceptar.</DialogDescription></DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (term.trim().length >= 2) void search(); }}>
          <Input aria-label="Buscar organización" placeholder="Nombre de la organización" value={term} onChange={(e) => setTerm(e.target.value)} />
          <Button type="submit" variant="outline" disabled={term.trim().length < 2}><Search />Buscar</Button>
        </form>
        {results && (results.length === 0 ? <p className="text-sm text-muted-foreground">Sin resultados. Si no la encuentras, pídele una invitación.</p> : (
          <ul className="space-y-1.5">{results.map((o) => (
            <li key={o.id}><button type="button" onClick={() => setPicked(o)} aria-pressed={picked?.id === o.id} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted ${picked?.id === o.id ? "border-primary bg-muted" : ""}`}><span className="font-medium">{o.display_name}</span><span className="text-xs text-muted-foreground">{o.country ?? ""}</span></button></li>))}</ul>))}
        {picked && <div className="space-y-1.5"><Label htmlFor="rel-msg">Mensaje (opcional)</Label><Textarea id="rel-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button><Button onClick={go} disabled={busy || !picked}>{busy ? "Enviando…" : "Enviar solicitud"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
