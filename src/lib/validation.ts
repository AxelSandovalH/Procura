import { z } from "zod";

/**
 * Postgres `date` vía Prisma requiere un `Date`/DateTime ISO completo, no "YYYY-MM-DD" plano.
 * Estos validadores aceptan la fecha corta que manda el cliente y la convierten para el ORM.
 */
export const isoDate = z.iso.date().transform((s) => new Date(s));
export const isoDateOptional = z.iso.date().optional().transform((s) => (s ? new Date(s) : undefined));
export const isoDateNullableOptional = z.iso.date().nullable().optional().transform((s) => (s === undefined ? undefined : s === null ? null : new Date(s)));
