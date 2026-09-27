import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://www.procuraos.app";

/** Solo la landing es indexable: la app requiere sesión y la API no debe rastrearse. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/$", disallow: ["/api/", "/inicio", "/requisiciones", "/ordenes", "/administracion"] }], sitemap: `${base}/sitemap.xml` };
}
