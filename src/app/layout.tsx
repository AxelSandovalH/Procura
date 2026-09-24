import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Procura",
  description: "Plataforma B2B de procurement e interoperabilidad entre organizaciones",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body className="antialiased">{children}</body>
    </html>
  );
}
