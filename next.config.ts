import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los planes anteriores (/precios/starter, /precios/compras…) ya no existen: ahora hay un solo esquema, en la portada.
  async redirects() {
    return [{ source: "/precios/:path*", destination: "/#precios", permanent: true }];
  },
};

export default nextConfig;
