import "dotenv/config";
import { defineConfig } from "prisma/config";

// La fuente de verdad del esquema es supabase/migrations/*.sql (aplicado con `supabase db push`).
// Prisma se usa como cliente: `npx prisma db pull` regenera los modelos desde la BD.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
