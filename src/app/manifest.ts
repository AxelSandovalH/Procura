import type { MetadataRoute } from "next";

/** Permite instalar Procura en el teléfono; Android arma la pantalla de arranque con el icono y estos colores. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Procura", short_name: "Procura", description: "Compras entre organizaciones en un solo flujo",
    start_url: "/inicio", scope: "/", display: "standalone", lang: "es-MX",
    background_color: "#2b2f32", theme_color: "#2b2f32",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
