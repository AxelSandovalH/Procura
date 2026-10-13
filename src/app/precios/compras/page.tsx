import type { Metadata } from "next";
import { Pricing } from "../../_landing/pricing";
import { LandingFooter, LandingHeader } from "../../_landing/shell";

export const metadata: Metadata = {
  title: "Planes de compras",
  description: "Planes de Procura para gestionar requisiciones, aprobaciones, cotizaciones, proveedores y órdenes de compra.",
  alternates: { canonical: "/precios/compras" },
};

/** Planes de compras entre organizaciones (los de siempre), separados de los planes de finanzas y fiscal. */
export default function PreciosCompras() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingHeader base="/" />
      <main><Pricing /></main>
      <LandingFooter base="/" />
    </div>
  );
}
