import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://www.procuraos.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const plans = ["starter", "business", "enterprise", "custom"].map((id) => ({ url: `${base}/precios/${id}`, changeFrequency: "monthly" as const, priority: 0.7 }));
  return [{ url: `${base}/`, changeFrequency: "monthly", priority: 1 }, ...plans];
}
