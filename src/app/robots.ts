import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://www.procuraos.app";

/** Indexables: la landing, el detalle de planes y el registro. La app requiere sesión y la API no debe rastrearse. */
export default function robots(): MetadataRoute.Robots {
  const app = ["/api/", "/inicio", "/comprar", "/requisiciones", "/aprobaciones", "/solicitudes", "/ordenes", "/gastos", "/ventas", "/facturas", "/banco", "/finanzas", "/relaciones", "/catalogo", "/administracion", "/cuenta", "/onboarding", "/invitations", "/login", "/olvide-contrasena", "/restablecer"];
  return { rules: [{ userAgent: "*", allow: ["/$", "/precios/", "/registro"], disallow: app }], sitemap: `${base}/sitemap.xml` };
}
