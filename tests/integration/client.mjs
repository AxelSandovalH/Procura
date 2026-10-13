// Utilidades para las pruebas de integración: cliente HTTP con cookies y acceso por enlace mágico (service role).
// ATENCIÓN: escriben en la base a la que apunta .env.local. Úsalas solo con un proyecto de pruebas o una organización de demostración.
import { readFileSync } from "node:fs";
import pg from "pg";

export const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
export const APP = process.env.PROCURA_URL ?? "http://localhost:3000";
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY;

export const db = async () => { const c = new pg.Client({ connectionString: env.DIRECT_URL }); await c.connect(); return c; };

export class Client {
  constructor(label) { this.label = label; this.jar = new Map(); }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  async raw(path, { method = "GET", body, headers = {}, redirect = "manual" } = {}) {
    const res = await fetch(APP + path, { method, redirect, headers: { ...(typeof body === "string" ? { "content-type": "application/json" } : {}), ...(this.cookie() ? { cookie: this.cookie() } : {}), ...headers }, body });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/max-age=0/i.test(c) || v === "") this.jar.delete(k); else this.jar.set(k, v); }
    return res;
  }
  /** Devuelve { status, body } sin lanzar: las pruebas comprueban también los rechazos. */
  async call(path, method = "GET", body, headers) {
    const res = await this.raw(`/api/v1${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
    const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    return { status: res.status, body: j };
  }
  async loginMagic(email) {
    const r = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: SK, authorization: `Bearer ${SK}`, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", email }) });
    const j = await r.json(); const hash = j.hashed_token ?? j.properties?.hashed_token; if (!hash) throw new Error("generate_link falló");
    const res = await this.raw(`/auth/callback?token_hash=${hash}&type=magiclink&next=/inicio`); if (res.status !== 307) throw new Error("callback " + res.status);
    return this;
  }
  async useOrg(id) { const r = await this.call("/me/active-organization", "POST", { organization_id: id }); if (r.status >= 300) throw new Error("useOrg " + r.status); return this; }
}

export const orgId = async (name) => { const c = await db(); const r = (await c.query("select id from organizations where display_name=$1", [name])).rows; await c.end(); if (r.length !== 1) throw new Error(`organización ${name}: ${r.length}`); return r[0].id; };
