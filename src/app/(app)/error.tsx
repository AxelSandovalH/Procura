"use client";
import { Button } from "@/components/ui/button";

/** Un fallo de render en una pantalla no debe tumbar el shell ni dejar la página en blanco. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed p-10 text-center">
      <p className="font-medium">Algo salió mal en esta pantalla</p>
      <p className="mt-1 text-sm text-muted-foreground">Tus datos no se perdieron. Intenta de nuevo; si persiste, avisa a soporte{error.digest ? ` con el código ${error.digest}` : ""}.</p>
      <Button className="mt-4" onClick={reset}>Reintentar</Button>
    </div>
  );
}
