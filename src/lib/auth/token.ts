import { randomBytes, createHash } from "node:crypto";

/** Genera un token opaco (base64url, 256 bits) y su hash sha256 para guardar en BD. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
