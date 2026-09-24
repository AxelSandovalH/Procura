import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Cliente Supabase de servidor: SOLO para Auth y Storage. Nunca consulta tablas (OD-36). */
export async function supabaseServer() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // En Server Components no se pueden escribir cookies; en Route Handlers sí.
        }
      },
    },
  });
}
