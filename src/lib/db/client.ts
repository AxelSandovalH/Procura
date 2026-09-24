import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

// Columnas bigint (montos en unidad menor, tamaños) llegan como BigInt; se serializan como número.
// Seguro hasta 2^53 (9e15): muy por encima de cualquier monto en centavos que manejemos.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () { return Number(this); };

// Un solo PrismaClient por proceso (serverless reutiliza el módulo entre invocaciones calientes).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL, max: 5 });
  return new PrismaClient({ adapter });
}

/** Inicialización perezosa: el build de Next evalúa los módulos de ruta sin variables de entorno. */
export function prisma(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = create();
  return globalForPrisma.prisma;
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface DbContext {
  userId?: string | null;
  organizationId?: string | null;
}

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de RLS fijado vía set_config(..., true)
 * (equivalente a SET LOCAL: muere con la transacción). Toda consulta de negocio pasa por aquí.
 * Sin organizationId la BD solo devuelve lo que la policy permite sin contexto (p. ej. memberships propias).
 */
export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma().$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.organization_id', ${ctx.organizationId ?? ""}, true)`;
    return fn(tx);
  });
}
