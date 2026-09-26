"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Pencil, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api-client";
import { money, toMinor } from "@/lib/format";

interface Item { id: string; sku: string; name: string; description: string | null; item_type: "GOOD" | "SERVICE"; unit_id: string | null; unit_label: string; list_price_minor: number | string | null; currency: string | null; category_id: string | null; is_active: boolean }
interface Category { id: string; name: string }
interface Unit { id: string; code: string; name: string }

export default function Catalogo() {
  const session = useSession();
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const [cat, setCat] = useState("ALL");
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [catDlg, setCatDlg] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams(); if (term) params.set("q", term); if (cat !== "ALL") params.set("category_id", cat); if (inactive) params.set("include_inactive", "1");
  const items = useQuery({ queryKey: ["catalog-items", term, cat, inactive], queryFn: () => api<{ data: Item[] }>(`/catalog/items?${params}`) });
  const cats = useQuery({ queryKey: ["catalog-categories"], queryFn: () => api<{ data: Category[] }>("/catalog/categories") });
  const canManage = session.can("catalog.manage");
  const rows = items.data?.data ?? [];
  const catItems = [{ value: "ALL", label: "Todas las categorías" }, ...(cats.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))];
  const catName = (id: string | null) => cats.data?.data.find((c) => c.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader title="Catálogo" description="Lo que vendes. Es privado: solo compartes lo que decidas con cada cliente."
        actions={canManage ? <>{session.can("catalog.import") && <Link href="/catalogo/importar" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted"><Upload className="size-4" />Importar</Link>}<Button variant="outline" onClick={() => setCatDlg(true)}>Categorías</Button><Button onClick={() => setEditing("new")}><Plus />Nuevo artículo</Button></> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input aria-label="Buscar artículo" className="w-64 pl-8" placeholder="SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select items={catItems} value={cat} onValueChange={(v) => setCat(v ?? "ALL")}>
          <SelectTrigger className="w-52" aria-label="Categoría"><SelectValue /></SelectTrigger>
          <SelectContent>{catItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Mostrar inactivos</label>
      </div>
      {items.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">{term || cat !== "ALL" ? "Sin coincidencias." : "Tu catálogo está vacío."}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Categoría</TableHead><TableHead>Unidad</TableHead><TableHead className="text-right">Precio de lista</TableHead>{canManage && <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>}</TableRow></TableHeader>
          <TableBody>{rows.map((i) => (
            <TableRow key={i.id} className={i.is_active ? "" : "text-muted-foreground"}>
              <TableCell className="font-mono text-xs">{i.sku}</TableCell>
              <TableCell className="font-medium">{i.name}{!i.is_active && <StatusBadge className="ml-2" label="Inactivo" tone="muted" />}</TableCell>
              <TableCell className="text-muted-foreground">{i.item_type === "GOOD" ? "Bien" : "Servicio"}</TableCell>
              <TableCell className="text-muted-foreground">{catName(i.category_id)}</TableCell>
              <TableCell className="text-muted-foreground">{i.unit_label}</TableCell>
              <TableCell className="text-right tabular-nums">{i.list_price_minor != null ? money(i.list_price_minor, i.currency ?? "MXN") : "—"}</TableCell>
              {canManage && <TableCell><Button size="icon-sm" variant="ghost" aria-label={`Editar ${i.name}`} onClick={() => setEditing(i)}><Pencil /></Button></TableCell>}
            </TableRow>))}</TableBody>
        </Table></div>
      )}
      {editing && <ItemDialog item={editing === "new" ? null : editing} categories={cats.data?.data ?? []} onClose={() => setEditing(null)} />}
      <CategoriesDialog open={catDlg} onOpenChange={setCatDlg} />
    </>
  );
}

function ItemDialog({ item, categories, onClose }: { item: Item | null; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ["catalog-units"], queryFn: () => api<{ data: Unit[] }>("/catalog/units") });
  const [f, setF] = useState({ sku: item?.sku ?? "", name: item?.name ?? "", description: item?.description ?? "", item_type: item?.item_type ?? "GOOD", unit_id: item?.unit_id ?? "", unit_label: item?.unit_label ?? "", price: item?.list_price_minor != null ? (Number(item.list_price_minor) / 100).toFixed(2) : "", category_id: item?.category_id ?? "", is_active: item?.is_active ?? true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const unitItems = (units.data?.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
  const catItems = [{ value: "NONE", label: "Sin categoría" }, ...categories.map((c) => ({ value: c.id, label: c.name }))];
  const typeItems = [{ value: "GOOD", label: "Bien" }, { value: "SERVICE", label: "Servicio" }];

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const price = f.price.trim() === "" ? null : toMinor(f.price);
    try {
      if (item) await api(`/catalog/items/${item.id}`, { method: "PATCH", body: { name: f.name.trim(), description: f.description.trim() || null, item_type: f.item_type, unit_id: f.unit_id || null, unit_label: f.unit_label.trim(), list_price_minor: price, category_id: f.category_id || null, is_active: f.is_active } });
      else await api("/catalog/items", { method: "POST", body: { sku: f.sku.trim(), name: f.name.trim(), description: f.description.trim() || undefined, item_type: f.item_type, unit_id: f.unit_id || undefined, unit_label: f.unit_label.trim(), list_price_minor: price ?? undefined, category_id: f.category_id || undefined } });
      await qc.invalidateQueries({ queryKey: ["catalog-items"] }); onClose();
    } catch (er) { setError(er instanceof ApiError ? (er.fieldErrors[0]?.message ?? er.detail ?? er.title) : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!busy && !o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? "Editar artículo" : "Nuevo artículo"}</DialogTitle><DialogDescription>{item ? `SKU ${item.sku}` : "El SKU no se puede cambiar después."}</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={go}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="i-sku">SKU *</Label><Input id="i-sku" required disabled={!!item} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Tipo</Label>
              <Select items={typeItems} value={f.item_type} onValueChange={(v) => setF({ ...f, item_type: (v ?? "GOOD") as "GOOD" | "SERVICE" })}><SelectTrigger className="w-full" aria-label="Tipo"><SelectValue /></SelectTrigger><SelectContent>{typeItems.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="i-name">Nombre *</Label><Input id="i-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="i-desc">Descripción</Label><Textarea id="i-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Unidad</Label>
              <Select items={unitItems} value={f.unit_id || null} onValueChange={(v) => { const u = units.data?.data.find((x) => x.id === v); setF({ ...f, unit_id: v ?? "", unit_label: u ? u.code : f.unit_label }); }}><SelectTrigger className="w-full" aria-label="Unidad"><SelectValue placeholder="Selecciona…" /></SelectTrigger><SelectContent>{unitItems.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="i-ul">Etiqueta de unidad *</Label><Input id="i-ul" required value={f.unit_label} onChange={(e) => setF({ ...f, unit_label: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="i-price">Precio de lista</Label><Input id="i-price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Categoría</Label>
              <Select items={catItems} value={f.category_id || "NONE"} onValueChange={(v) => setF({ ...f, category_id: !v || v === "NONE" ? "" : v })}><SelectTrigger className="w-full" aria-label="Categoría del artículo"><SelectValue /></SelectTrigger><SelectContent>{catItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Activo</label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["catalog-categories"], queryFn: () => api<{ data: Category[] }>("/catalog/categories"), enabled: open });
  const [name, setName] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/catalog/categories", { method: "POST", body: { name: name.trim() } }); setName(""); await qc.invalidateQueries({ queryKey: ["catalog-categories"] }); }
    catch (er) { setError(er instanceof ApiError ? (er.detail ?? er.title) : "No se pudo crear."); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>Categorías</DialogTitle><DialogDescription>Agrupa artículos para filtrarlos o compartirlos juntos.</DialogDescription></DialogHeader>
      <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">{(cats.data?.data ?? []).length === 0 ? <li className="text-muted-foreground">Sin categorías.</li> : cats.data!.data.map((c) => <li key={c.id} className="rounded-lg border px-3 py-1.5">{c.name}</li>)}</ul>
      <form className="flex gap-2" onSubmit={add}><Input aria-label="Nombre de la categoría" placeholder="Nueva categoría" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" disabled={busy || !name.trim()}>Agregar</Button></form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent></Dialog>
  );
}
