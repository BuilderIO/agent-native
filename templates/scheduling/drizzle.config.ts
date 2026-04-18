import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/scheduling.db";
const isPg = databaseUrl.startsWith("postgres");

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: isPg ? "postgresql" : "sqlite",
  dbCredentials: { url: databaseUrl } as any,
});
