/** Cliente de la API v1 para el navegador. Misma API que usa un ERP: cookies de sesión, errores RFC 9457. */
export class ApiError extends Error {
  constructor(public status: number, public title: string, public detail?: string, public fieldErrors: { field: string; message: string }[] = [], public requestId?: string) {
    super(detail ?? title);
  }
}

interface Options { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal }

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin", signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, data?.title ?? "Error", data?.detail, data?.errors, data?.request_id);
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw err;
  }
  return data as T;
}
