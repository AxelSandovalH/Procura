"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ActionDialog } from "@/components/app/action-dialog";
import { apiErr } from "@/components/app/finance-sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api-client";
import { dateShort, money } from "@/lib/format";

interface Account { id: string; name: string; bank: string | null; currency: string; last4: string | null; unmatched: number; matched: number }
interface Suggestion { kind: "payment" | "expense" | "sale"; id: string; payment_id?: string; label: string; date: string; amount_minor: number; score: number; reason: string }
interface Txn { id: string; posted_at: string; description: string; amount_minor: number; status: string; currency: string; suggestions: Suggestion[] }
interface Preview { total: number; new: number; duplicates: number; skipped: number; from: string; to: string; columns: { date: string; description: string; amount: string }; warnings: string[]; charges_minor: number; deposits_minor: number }
const TABS = [["UNMATCHED", "Por conciliar"], ["MATCHED", "Conciliados"], ["IGNORED", "Ignorados"]] as const;

/** Lee el archivo del banco: UTF-8 y, si no lo es (muchos bancos exportan en Windows-1252), con ese juego de caracteres. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

export default function BancoPage() {
  const session = useSession(); const qc = useQueryClient();
  const canWrite = session.can("payment.manage");
  const [accountId, setAccountId] = useState<string | null>(null); const [tab, setTab] = useState<(typeof TABS)[number][0]>("UNMATCHED");
  const [newAcct, setNewAcct] = useState(false); const [importing, setImporting] = useState(false); const [toExpense, setToExpense] = useState<Txn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ["bank-accounts"], queryFn: () => api<{ data: Account[] }>("/bank/accounts"), enabled: session.can("finance.read") });
  const list = accounts.data?.data ?? []; const current = list.find((a) => a.id === accountId) ?? list[0] ?? null;
  const txns = useQuery({ queryKey: ["bank-txns", current?.id, tab], queryFn: () => api<{ data: Txn[] }>(`/bank/transactions?account_id=${current!.id}&status=${tab}`), enabled: !!current });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["bank-accounts"] }), qc.invalidateQueries({ queryKey: ["bank-txns"] }), ...["expenses", "expense", "sales", "sale", "finance"].map((k) => qc.invalidateQueries({ queryKey: [k] }))]);
  async function act(path: string, body: unknown) { setError(null); try { await api(path, { body }); await refresh(); } catch (e) { setError(apiErr(e, "No se pudo completar la acción.")); } }
  if (!session.can("finance.read")) return <p className="text-sm text-muted-foreground">No tienes permiso para ver el banco.</p>;
  const rows = txns.data?.data ?? [];
  return (
    <>
      <PageHeader title="Banco" description="Importa el estado de cuenta y confirma cada movimiento contra un gasto, venta o pago registrado."
        actions={canWrite ? <div className="flex gap-2">{current && <Button variant="outline" onClick={() => setImporting(true)}><Upload />Importar movimientos</Button>}<Button onClick={() => setNewAcct(true)}><Plus />Nueva cuenta</Button></div> : undefined} />
      {accounts.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : !current ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center"><Landmark className="mb-2 size-8 text-muted-foreground" /><p className="font-medium">Aún no hay cuentas</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{canWrite ? "Registra una cuenta (solo nombre y últimos 4 dígitos), sube el CSV de tu estado de cuenta y Procura te sugiere con qué gasto o venta corresponde cada movimiento." : "Cuando se registre una cuenta aparecerá aquí."}</p></div>
      ) : (<>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {list.map((a) => <button key={a.id} onClick={() => setAccountId(a.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${a.id === current.id ? "border-foreground bg-muted font-medium" : "text-muted-foreground"}`}>{a.name}{a.last4 ? ` ·${a.last4}` : ""} <span className="text-xs">({a.unmatched} por conciliar)</span></button>)}
        </div>
        <div className="mb-3 flex gap-1 border-b">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === k ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}>{l}</button>)}</div>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        {txns.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted" /> : rows.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{tab === "UNMATCHED" ? "Nada por conciliar. Importa un estado de cuenta para empezar." : "Sin movimientos."}</p> : (
          <ul className="divide-y rounded-xl border text-sm">{rows.map((t) => (
            <li key={t.id} className="grid gap-2 p-3 md:grid-cols-[7rem_minmax(0,1fr)_9rem_minmax(0,22rem)] md:items-start">
              <span className="text-muted-foreground">{dateShort(t.posted_at)}</span>
              <span className="min-w-0 break-words">{t.description}</span>
              <span className={`tabular-nums font-medium md:text-right ${t.amount_minor < 0 ? "" : "text-emerald-700"}`}>{money(t.amount_minor, t.currency)}</span>
              <div className="min-w-0 space-y-1.5">
                {t.status === "UNMATCHED" && canWrite && (<>
                  {t.suggestions.map((s) => (
                    <div key={`${s.kind}${s.id}`} className="rounded-lg border bg-muted/30 p-2">
                      <p className="break-words">{s.label}</p><p className="text-xs text-muted-foreground">{dateShort(s.date)} · {s.reason} · {s.score}%</p>
                      <Button size="sm" className="mt-1" onClick={() => void act(`/bank/transactions/${t.id}/reconcile`, s.kind === "payment" ? { payment_id: s.payment_id } : s.kind === "expense" ? { expense_id: s.id } : { sale_id: s.id })}>Conciliar</Button>
                    </div>))}
                  {t.suggestions.length === 0 && <p className="text-xs text-muted-foreground">Sin coincidencias exactas de importe.</p>}
                  <div className="flex flex-wrap gap-1">{t.amount_minor < 0 && <Button size="sm" variant="outline" onClick={() => setToExpense(t)}>Crear gasto</Button>}<Button size="sm" variant="ghost" onClick={() => void act(`/bank/transactions/${t.id}/ignore`, { ignored: true })}>Ignorar</Button></div>
                </>)}
                {t.status === "MATCHED" && <div className="flex items-center gap-2"><span className="text-emerald-700">Conciliado</span>{canWrite && <Button size="sm" variant="ghost" onClick={() => void act(`/bank/transactions/${t.id}/unmatch`, {})}>Deshacer</Button>}</div>}
                {t.status === "IGNORED" && canWrite && <Button size="sm" variant="ghost" onClick={() => void act(`/bank/transactions/${t.id}/ignore`, { ignored: false })}>Devolver a por conciliar</Button>}
              </div>
            </li>))}</ul>)}
      </>)}
      <NewAccount open={newAcct} onOpenChange={setNewAcct} onDone={async (id) => { await refresh(); setAccountId(id); }} />
      {current && <ImportDialog open={importing} onOpenChange={setImporting} account={current} onDone={refresh} />}
      <ActionDialog open={!!toExpense} onOpenChange={(o) => !o && setToExpense(null)} title="Crear gasto desde el cargo" description={toExpense ? `${money(Math.abs(toExpense.amount_minor), toExpense.currency)} · ${dateShort(toExpense.posted_at)}. Se crea ya pagado y conciliado.` : ""} fieldLabel="Descripción del gasto" required confirmLabel="Crear gasto"
        onConfirm={async (desc) => { await api(`/bank/transactions/${toExpense!.id}/expense`, { body: { description: desc } }); await refresh(); setToExpense(null); }} />
    </>
  );
}

function NewAccount({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => Promise<unknown> }) {
  const [f, setF] = useState({ name: "", bank: "", last4: "", currency: "MXN" }); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const a = await api<{ id: string }>("/bank/accounts", { body: { name: f.name, bank: f.bank || null, last4: f.last4 || null, currency: f.currency } }); await onDone(a.id); setF({ name: "", bank: "", last4: "", currency: "MXN" }); onOpenChange(false); }
    catch (er) { setError(apiErr(er, "No se pudo crear la cuenta.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
      <DialogHeader><DialogTitle>Nueva cuenta bancaria</DialogTitle><DialogDescription>Solo para identificarla: nombre y últimos 4 dígitos. Nunca pongas el número completo ni claves.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-3">
        <div className="space-y-1"><Label htmlFor="b-name">Nombre</Label><Input id="b-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="BBVA empresarial" autoFocus /></div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1"><Label htmlFor="b-bank">Banco</Label><Input id="b-bank" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="b-l4">Últimos 4</Label><Input id="b-l4" inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "") })} /></div>
          <div className="space-y-1"><Label htmlFor="b-cur">Moneda</Label><select id="b-cur" className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>MXN</option><option>USD</option></select></div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={busy || !f.name.trim()}>Crear cuenta</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  );
}

function ImportDialog({ open, onOpenChange, account, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account; onDone: () => Promise<unknown> }) {
  const [csv, setCsv] = useState<string | null>(null); const [name, setName] = useState(""); const [prev, setPrev] = useState<Preview | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const reset = () => { setCsv(null); setName(""); setPrev(null); setError(null); };
  async function pick(file: File | undefined) {
    if (!file) return; reset(); setBusy(true);
    try { const text = await readText(file); setCsv(text); setName(file.name); setPrev(await api<Preview>(`/bank/accounts/${account.id}/import`, { body: { csv: text, dry_run: true } })); }
    catch (er) { setError(apiErr(er, "No pude leer el archivo.")); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError(null);
    try { await api(`/bank/accounts/${account.id}/import`, { body: { csv, dry_run: false } }); await onDone(); reset(); onOpenChange(false); }
    catch (er) { setError(apiErr(er, "No se pudo importar.")); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}><DialogContent>
      <DialogHeader><DialogTitle>Importar movimientos · {account.name}</DialogTitle><DialogDescription>Sube el estado de cuenta en CSV (el banco lo llama «exportar movimientos»). Necesita fecha, descripción y monto (o cargos y abonos).</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm">
        <input type="file" accept=".csv,.txt,text/csv" aria-label="Archivo CSV" onChange={(e) => void pick(e.target.files?.[0])} />
        {busy && <p className="text-muted-foreground">Leyendo…</p>}
        {prev && (
          <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
            <p className="font-medium">{name}</p>
            <p>{prev.total} movimientos del {dateShort(prev.from)} al {dateShort(prev.to)}: <b>{prev.new} nuevos</b>{prev.duplicates > 0 && `, ${prev.duplicates} ya estaban`}.</p>
            <p className="text-xs text-muted-foreground">Columnas usadas: {prev.columns.date} · {prev.columns.description} · {prev.columns.amount}. Cargos nuevos {money(prev.charges_minor, account.currency)} · abonos nuevos {money(prev.deposits_minor, account.currency)}.</p>
            {prev.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
          </div>)}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => void confirm()} disabled={busy || !prev || prev.new === 0}>{prev ? `Importar ${prev.new} nuevos` : "Importar"}</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}
