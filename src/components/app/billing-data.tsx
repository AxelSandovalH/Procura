"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { paymentFormFor, satLabel, SAT_REGIMES, SAT_USES } from "@/lib/ui/sat-catalogs";

export interface FiscalProfile { legal_name: string; display_name: string; tax_id: string | null; profile: { tax_regime_code: string | null; zip_code: string | null; cfdi_use_code: string; street: string | null; exterior_number: string | null; interior_number: string | null; neighborhood: string | null; municipality: string | null; state: string | null; invoice_email: string | null } }

export function addressLine(p: FiscalProfile["profile"]) {
  const street = [p.street, p.exterior_number ? `No. ${p.exterior_number}` : null, p.interior_number ? `Int. ${p.interior_number}` : null].filter(Boolean).join(" ");
  return [street, p.neighborhood ? `Col. ${p.neighborhood}` : null, p.zip_code ? `C.P. ${p.zip_code}` : null, p.municipality, p.state].filter(Boolean).join(", ");
}

/** Datos listos para copiar y pegar al pedir la factura de un gasto a mano (portal del comercio, correo o WhatsApp). */
export function BillingDataCard({ paymentMethod }: { paymentMethod?: string | null }) {
  const q = useQuery({ queryKey: ["fiscal-profile"], queryFn: () => api<FiscalProfile>("/organization/fiscal-profile"), staleTime: 60_000 });
  const [copied, setCopied] = useState<string | null>(null);
  if (!q.data) return null;
  const d = q.data, p = d.profile;
  const rows: { key: string; label: string; value: string | null }[] = [
    { key: "name", label: "Razón social", value: d.legal_name }, { key: "rfc", label: "RFC", value: d.tax_id },
    { key: "regime", label: "Régimen fiscal", value: satLabel(SAT_REGIMES, p.tax_regime_code) }, { key: "zip", label: "Código postal fiscal", value: p.zip_code },
    { key: "use", label: "Uso de CFDI", value: satLabel(SAT_USES, p.cfdi_use_code) }, { key: "addr", label: "Domicilio", value: addressLine(p) || null },
    { key: "mail", label: "Correo para la factura", value: p.invoice_email }, { key: "form", label: "Forma de pago", value: paymentFormFor(paymentMethod) },
  ];
  const missing = rows.filter((r) => !r.value && r.key !== "form" && r.key !== "mail" && r.key !== "addr").map((r) => r.label);
  async function copy(key: string, text: string) { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); } catch { /* sin permiso de portapapeles */ } }
  const all = rows.filter((r) => r.value).map((r) => `${r.label}: ${r.value}`).join("\n");
  return (
    <section className="space-y-2 rounded-lg border p-3" aria-label="Datos para pedir la factura">
      <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Datos para pedir tu factura</h3><Button size="sm" variant="outline" onClick={() => void copy("all", all)}>{copied === "all" ? <Check /> : <Copy />}{copied === "all" ? "Copiado" : "Copiar todo"}</Button></div>
      <dl className="space-y-1 text-sm">{rows.map((r) => (
        <div key={r.key} className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
          <dd className="flex min-w-0 items-start gap-1 text-right">{r.value ? <><span className="break-words">{r.value}</span><button type="button" aria-label={`Copiar ${r.label}`} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => void copy(r.key, r.value!)}>{copied === r.key ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button></> : <span className="text-muted-foreground">—</span>}</dd>
        </div>))}</dl>
      {missing.length > 0 && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">Faltan datos ({missing.join(", ")}). Complétalos en <Link href="/administracion/organizacion" className="underline">Administración → Organización</Link>.</p>}
    </section>
  );
}
