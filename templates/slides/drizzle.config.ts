import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL || "file:./data/app.db";
const isRemote = !url.startsWith("file:");

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: isRemote ? "turso" : "sqlite",
  dbCredentials: isRemote
    ? { url, authToken: process.env.DATABASE_AUTH_TOKEN! }
    : { url: "./data/app.db" },
});
