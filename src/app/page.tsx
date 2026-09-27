import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="sr-only">Procura</h1>
      <Logo size={56} textClassName="text-5xl" />
      <p className="max-w-md text-muted-foreground">Compras entre organizaciones: requisiciones, aprobaciones, cotizaciones, órdenes y entregas en un solo flujo.</p>
      <div className="flex gap-2">
        <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>Iniciar sesión</Link>
        <Link href="/registro" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>Crear cuenta</Link>
      </div>
    </main>
  );
}
