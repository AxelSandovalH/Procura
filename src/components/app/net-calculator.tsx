"use client";
import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { grossUpFromNet } from "@/lib/commercial/net-amount";
import { money, toMinor } from "@/lib/format";

/**
 * Calculadora «quiero recibir tanto»: dado el monto NETO que el cliente va a pagar (ya con IVA y retenciones), da el subtotal que hay que facturar.
 * Para un RESICO que le factura un servicio a una persona moral: retención de ISR 1.25 % y de IVA 10.6667 %.
 */
export function NetCalculator({ currency, onUse }: { currency: string; onUse: (r: { subtotalMinor: number; netMinor: number; isr: boolean; ivaRet: boolean }) => void }) {
  const [open, setOpen] = useState(false); const [net, setNet] = useState(""); const [isr, setIsr] = useState(true); const [ivaRet, setIvaRet] = useState(true);
  const netMinor = toMinor(net || "0"); const g = netMinor > 0 ? grossUpFromNet(netMinor, { isr, ivaRet }) : null;
  if (!open) return <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}><Calculator />Calcular desde el monto neto que quiero recibir</Button>;
  return (
    <fieldset className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <legend className="px-1 font-medium">Calculadora de monto neto</legend>
      <p className="text-xs text-muted-foreground">Escribe lo que el cliente te va a pagar, ya con IVA y retenciones. Te digo cuánto facturar. Úsala cuando el cliente es persona moral y te retiene.</p>
      <div className="grid grid-cols-[10rem_1fr] items-end gap-3">
        <div className="space-y-1"><Label htmlFor="nc-net" className="text-xs">Neto a recibir ({currency})</Label><Input id="nc-net" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} placeholder="10000.00" /></div>
        <div className="space-y-1">
          <label className="flex items-center gap-2"><input type="checkbox" checked={isr} onChange={(e) => setIsr(e.target.checked)} />Retención de ISR 1.25 %</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={ivaRet} onChange={(e) => setIvaRet(e.target.checked)} />Retención de IVA 10.6667 %</label>
        </div>
      </div>
      {g && (
        <dl className="ml-auto w-full max-w-xs space-y-1">
          <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal a facturar</dt><dd className="font-semibold tabular-nums">{money(g.subtotal, currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">+ IVA 16 %</dt><dd className="tabular-nums">{money(g.iva, currency)}</dd></div>
          {g.isr > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">− Retención ISR</dt><dd className="tabular-nums">{money(g.isr, currency)}</dd></div>}
          {g.ivaRet > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">− Retención IVA</dt><dd className="tabular-nums">{money(g.ivaRet, currency)}</dd></div>}
          <div className="flex justify-between border-t pt-1 font-semibold"><dt>Neto que recibes</dt><dd className="tabular-nums">{money(g.net, currency)}</dd></div>
          {!g.exact && <p className="text-xs text-amber-700">Por redondeo no hay un subtotal que dé exactamente ese neto; el más cercano difiere {money(Math.abs(g.net - netMinor), currency)}.</p>}
        </dl>)}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
        <Button type="button" size="sm" disabled={!g} onClick={() => { if (g) { onUse({ subtotalMinor: g.subtotal, netMinor: g.net, isr, ivaRet }); setOpen(false); } }}>Usar este subtotal</Button>
      </div>
    </fieldset>
  );
}
