import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Cliente con service role: SOLO servidor y SOLO para Storage. Salta RLS de Supabase, así que
 * nunca se le pasa una decisión de acceso al cliente — la autorización ocurre antes en la app.
 */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const e = env();
  if (!e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada");
  cached = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export const ATTACHMENTS_BUCKET = "attachments";

let bucketReady = false;
/** Crea el bucket privado si no existe (idempotente). */
export async function ensureAttachmentsBucket() {
  if (bucketReady) return;
  const admin = supabaseAdmin();
  const { error } = await admin.storage.createBucket(ATTACHMENTS_BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`No se pudo preparar el bucket: ${error.message}`);
  bucketReady = true;
}
