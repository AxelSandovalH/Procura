export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="text-xl font-semibold tracking-tight">Procura</div>
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">Compras entre organizaciones, sin hojas de cálculo ni correos perdidos.</h2>
          <p className="text-sm text-primary-foreground/70">Requisiciones, aprobaciones, cotizaciones, órdenes y entregas en un solo flujo — y cada organización conserva lo suyo en privado.</p>
        </div>
        <div className="text-xs text-primary-foreground/50">Requisición → Aprobación → Cotización → Orden → Entrega → Recepción</div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
