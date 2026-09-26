import { randomBytes } from "node:crypto";

/**
 * A diferencia de las API keys (donde solo VERIFICAMOS un valor que nos mandan, y un hash basta),
 * el secreto de un webhook lo usamos NOSOTROS para FIRMAR cada request saliente — necesitamos el
 * valor en texto plano en el momento del despacho, no solo un hash de un solo sentido.
 * Limitación conocida del MVP: se guarda en claro en `webhook_endpoints.secret_hash` (nombre de
 * columna heredado del diseño original). Endurecimiento futuro: cifrado a nivel de columna o KMS.
 */
export function generateWebhookSecret(): { secret: string } {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return { secret };
}
