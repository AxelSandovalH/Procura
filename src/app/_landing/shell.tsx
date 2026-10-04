import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Encabezado y pie de la landing, compartidos con las páginas de detalle de plan. `base` = "" en la landing y "/" en otras rutas (las anclas apuntan a la portada). */
export function LandingHeader({ base = "" }: { base?: string }) {
  return (
  <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
    <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 lg:gap-6">
      <Link href="/" aria-label="Procura, inicio"><Logo size={22} textClassName="text-lg" /></Link>
      <nav aria-label="Secciones" className="hidden flex-1 items-center gap-3 text-sm text-muted-foreground md:flex lg:gap-6">
        <a href={`${base}#como-funciona`} className="hover:text-foreground">Cómo funciona</a>
        <a href={`${base}#compradores`} className="hover:text-foreground">Para quien compra</a>
        <a href={`${base}#proveedores`} className="hover:text-foreground">Para quien vende</a>
        <a href={`${base}#integraciones`} className="hover:text-foreground">Integraciones</a>
        <a href={`${base}#precios`} className="hover:text-foreground">Precios</a>
        <a href={`${base}#preguntas`} className="hover:text-foreground">Preguntas</a>
      </nav>
      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <Link href="/login" className={cn(buttonVariants({ variant: "ghost" }))}>Iniciar sesión</Link>
        <Link href="/registro" className={cn(buttonVariants())}>Crear cuenta</Link>
      </div>
    </div>
  </header>
  );
}

export function LandingFooter({ base = "" }: { base?: string }) {
  return (
  <footer className="border-t">
    <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center">
      <Logo size={18} textClassName="text-base" className="text-foreground" />
      <nav aria-label="Pie" className="flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/login" className="hover:text-foreground">Iniciar sesión</Link>
        <Link href="/registro" className="hover:text-foreground">Crear cuenta</Link>
        <a href={`${base}#preguntas`} className="hover:text-foreground">Preguntas</a>
      </nav>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>© {new Date().getFullYear()} Procura</span>
        <span aria-hidden className="hidden h-3 w-px bg-border sm:inline-block" />
        <a href="https://axelsandoval.dev" target="_blank" rel="noopener" className="rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:outline-none">Diseñado y desarrollado por <span className="font-medium">axelsandoval.dev</span><span className="sr-only"> (se abre en una pestaña nueva)</span></a>
      </p>
    </div>
  </footer>
  );
}
