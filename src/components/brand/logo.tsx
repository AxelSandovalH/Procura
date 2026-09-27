import { cn } from "@/lib/utils";

/** Símbolo de Procura (vectorizado del logo original). Toma el color del texto: `currentColor`. */
export function LogoMark({ className, title, style }: { className?: string; title?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="342 281 342 462" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={cn("h-6 w-auto", className)} style={style} fill="currentColor">
      <path d="M387.00 419.45L387.00 742.79L454.00 698.46L454.00 585.50L512.50 585.50L512.50 636.83L639.03 553.16L512.50 469.24L512.50 519.75L454.00 519.75L454.00 464.01ZM342.07 364.98L468.75 281.29L468.75 331.25L555.50 331.25A126.6 126.6 0 0 1 653.74 537.71L597.56 500.51A60.3 60.3 0 0 0 555.50 397.00L468.75 397.00L468.75 448.36Z" />
    </svg>
  );
}

/** Símbolo + nombre. `size` es la altura del símbolo; el texto escala con ella. */
export function Logo({ size = 24, className, textClassName }: { size?: number; className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark className="w-auto" style={{ height: size }} />
      <span className={cn("leading-none", textClassName)} style={{ fontSize: size * 0.85 }}>Procura</span>
    </span>
  );
}
