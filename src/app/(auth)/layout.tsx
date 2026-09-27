import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" aria-label="Procura, volver al inicio" className="w-fit rounded-md outline-none focus-visible:ring-3 focus-visible:ring-primary-foreground/40"><Logo size={28} textClassName="text-xl" /></Link>
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">Compras entre organizaciones, sin hojas de cálculo ni correos perdidos.</h2>
          <p className="text-sm text-primary-foreground/70">Requisiciones, aprobaciones, cotizaciones, órdenes y entregas en un solo flujo — y cada organización conserva lo suyo en privado.</p>
        </div>
        <div className="text-xs text-primary-foreground/50">Requisición → Aprobación → Cotización → Orden → Entrega → Recepción</div>
      </section>
      <section className="relative flex items-center justify-center p-6">
        <Link href="/" className="absolute top-5 left-5 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:top-6 sm:left-6"><ArrowLeft className="size-4" />Volver al inicio</Link>
        <div className="w-full max-w-sm">
          <Link href="/" aria-label="Procura, volver al inicio" className="mb-8 block w-fit lg:hidden"><Logo size={24} textClassName="text-lg" /></Link>
          {children}
        </div>
      </section>
    </main>
  );
}
