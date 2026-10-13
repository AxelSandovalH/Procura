import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://www.procuraos.app";

/** Solo páginas públicas e indexables: la portada (con sus planes) y el registro. La app (con sesión) y la API no entran. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/registro`, lastModified, changeFrequency: "yearly", priority: 0.5 },
  ];
}
