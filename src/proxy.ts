import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirección OPTIMISTA por presencia de cookie de sesión de Supabase (Next 16 "proxy").
 * No autoriza nada: cada dato lo protege la API (401/403/404 en servidor). Esto solo evita
 * mostrar el shell a quien no tiene sesión y saltarse el login a quien ya la tiene.
 */
const PUBLIC = ["/login", "/registro"];
/** Portal público de un proveedor: /{slug}/solicitar. Lo ven tanto anónimos como con sesión (la API decide el siguiente paso). */
const PORTAL = /^\/[^/]+\/solicitar\/?$/;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  if (pathname === "/") return hasSession ? NextResponse.redirect(new URL("/inicio", req.url)) : NextResponse.next();
  if (PORTAL.test(pathname)) return NextResponse.next();
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hasSession && !isPublic) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (hasSession && isPublic) return NextResponse.redirect(new URL("/inicio", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
