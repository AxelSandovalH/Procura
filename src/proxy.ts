import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirección OPTIMISTA por presencia de cookie de sesión de Supabase (Next 16 "proxy").
 * No autoriza nada: cada dato lo protege la API (401/403/404 en servidor). Esto solo evita
 * mostrar el shell a quien no tiene sesión y saltarse el login a quien ya la tiene.
 */
const PUBLIC = ["/login", "/registro", "/olvide-contrasena"];
/** Rutas que funcionan con o sin sesión: el callback de los correos y el restablecimiento (que necesita la sesión de recuperación). */
const NEUTRAL = ["/auth/callback", "/restablecer", "/opengraph-image"];
/** Portal público de un proveedor: /{slug}/solicitar. Lo ven tanto anónimos como con sesión (la API decide el siguiente paso). */
const SESSION_COOKIE = /^sb-[a-z0-9]+-auth-token(\.\d+)?$/;
const PORTAL = /^\/[^/]+\/solicitar\/?$/;
/** Detalle público de cada plan: /precios/starter, /precios/business… */
const PRECIOS = /^\/precios\/[a-z]+\/?$/;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Solo la cookie de sesión (`sb-<ref>-auth-token`, posiblemente en trozos `.0`, `.1`). Las de `…-code-verifier` (PKCE) existen
  // tras pedir un correo de recuperación o registrarse, sin que haya sesión: contarlas causaba un bucle /login ↔ /inicio.
  const hasSession = req.cookies.getAll().some((c) => SESSION_COOKIE.test(c.name));

  if (pathname === "/") return hasSession ? NextResponse.redirect(new URL("/inicio", req.url)) : NextResponse.next();
  if (PORTAL.test(pathname) || PRECIOS.test(pathname) || NEUTRAL.includes(pathname)) return NextResponse.next();
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hasSession && !isPublic) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (hasSession && isPublic) return NextResponse.redirect(new URL("/inicio", req.url));
  return NextResponse.next();
}

// Los archivos estáticos públicos (iconos, logo, imágenes, robots…) no pasan por el filtro de sesión: sin esto un visitante anónimo
// recibía un 307 a /login en /icon.svg, /apple-icon.png y /brand/*, y el navegador no podía mostrar el icono de la pestaña.
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)"] };
