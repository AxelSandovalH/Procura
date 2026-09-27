import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://www.procuraos.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${base}/`, changeFrequency: "monthly", priority: 1 }];
}
