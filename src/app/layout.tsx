import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/app/providers";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://www.procuraos.app"),
  title: { default: "Procura", template: "%s · Procura" },
  description: "Plataforma B2B de procurement e interoperabilidad entre organizaciones",
  openGraph: { type: "website", siteName: "Procura", locale: "es_MX" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
