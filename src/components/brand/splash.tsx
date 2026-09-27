/**
 * Pantalla de arranque: las dos mitades del símbolo (la flecha que vuelve y la que avanza) se encuentran en el centro.
 * Aparece con un retraso de 150 ms para que una carga rápida no parpadee, y respeta `prefers-reduced-motion`.
 */
export function Splash({ label = "Cargando Procura…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="splash flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <svg viewBox="342 281 342 462" aria-hidden className="h-24 w-auto" fill="currentColor">
        <path className="splash-a" d="M342.07 364.98L468.75 281.29L468.75 331.25L555.50 331.25A126.6 126.6 0 0 1 653.74 537.71L597.56 500.51A60.3 60.3 0 0 0 555.50 397.00L468.75 397.00L468.75 448.36Z" />
        <path className="splash-b" d="M387.00 419.45L387.00 742.79L454.00 698.46L454.00 585.50L512.50 585.50L512.50 636.83L639.03 553.16L512.50 469.24L512.50 519.75L454.00 519.75L454.00 464.01Z" />
      </svg>
      <p className="sr-only">{label}</p>
      <span aria-hidden className="splash-bar h-0.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full w-1/2 rounded-full bg-foreground" /></span>
    </div>
  );
}
