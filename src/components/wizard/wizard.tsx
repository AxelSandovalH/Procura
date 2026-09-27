"use client";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Cabecera de progreso de un asistente: pasos numerados; los hechos muestran una palomita. */
export function WizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Progreso" className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <li key={s} aria-current={active ? "step" : undefined} className="flex flex-1 items-center gap-2">
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium", done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary" : "text-muted-foreground")}>
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("hidden truncate sm:inline", active ? "font-medium" : "text-muted-foreground")}>{s}</span>
            {i < steps.length - 1 && <span className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} aria-hidden />}
          </li>);
      })}
    </ol>
  );
}

/** Pie con Atrás / Omitir / Continuar. `onNext` puede ser asíncrono: el botón queda ocupado mientras corre. */
export function WizardFooter({ onBack, onSkip, onNext, nextLabel = "Continuar", busy, disabled, skipLabel = "Omitir por ahora" }: {
  onBack?: () => void; onSkip?: () => void; onNext: () => void; nextLabel?: string; busy?: boolean; disabled?: boolean; skipLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <div className="flex items-center gap-2">
        {onBack && <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>Atrás</Button>}
        {onSkip && <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onSkip} disabled={busy}>{skipLabel}</Button>}
      </div>
      <Button type="button" onClick={onNext} disabled={busy || disabled}>{busy ? "Guardando…" : nextLabel}</Button>
    </div>
  );
}
