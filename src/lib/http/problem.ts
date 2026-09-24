import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Error de aplicación serializable como RFC 9457 (application/problem+json). */
export class Problem extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
  }

  static badRequest(detail: string) { return new Problem(400, "Solicitud inválida", detail); }
  static unauthorized(detail = "Autenticación requerida") { return new Problem(401, "No autenticado", detail); }
  static forbidden(detail = "No tienes permiso para esta acción") { return new Problem(403, "Prohibido", detail); }
  /** Recursos de otra organización responden 404, nunca 403 (no revelar existencia). */
  static notFound(detail = "Recurso no encontrado") { return new Problem(404, "No encontrado", detail); }
  static conflict(detail: string) { return new Problem(409, "Conflicto", detail); }
  static validation(errors: { field: string; code: string; message: string }[]) {
    return new Problem(422, "Error de validación", "Uno o más campos son inválidos", { errors });
  }
}

export function problemResponse(p: Problem, requestId: string) {
  return NextResponse.json(
    { type: `https://procura.app/problems/${p.status}`, title: p.title, status: p.status, detail: p.detail, request_id: requestId, ...p.extra },
    { status: p.status, headers: { "content-type": "application/problem+json" } },
  );
}

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;

/** Envuelve un Route Handler: convierte Problem / ZodError / errores inesperados en problem+json. */
export function route(handler: Handler) {
  return async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    try {
      const params = (await ctx?.params) ?? {};
      const res = await handler(req, params);
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      if (err instanceof Problem) return problemResponse(err, requestId);
      if (err instanceof ZodError) {
        return problemResponse(
          Problem.validation(err.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message }))),
          requestId,
        );
      }
      console.error(`[${requestId}]`, err);
      return problemResponse(new Problem(500, "Error interno"), requestId);
    }
  };
}

export async function json<T>(req: Request, parse: (data: unknown) => T): Promise<T> {
  let body: unknown;
  try { body = await req.json(); } catch { throw Problem.badRequest("El cuerpo debe ser JSON válido"); }
  return parse(body);
}
