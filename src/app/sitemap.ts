import type { MetadataRoute } from "next";
import { PLANS } from "./_landing/pricing-data";

const base = process.env.APP_URL ?? "https://www.procuraos.app";

/** Solo páginas públicas e indexables: la portada, el detalle de cada plan y el registro. La app (con sesión) y la API no entran. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    ...PLANS.map((p) => ({ url: `${base}/precios/${p.id}`, lastModified, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${base}/precios/compras`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/registro`, lastModified, changeFrequency: "yearly", priority: 0.5 },
  ];
}
