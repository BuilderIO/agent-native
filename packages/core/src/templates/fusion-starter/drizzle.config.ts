import "dotenv/config";
import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

export default createDrizzleConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  // config-ok: drizzle-kit loads this file outside the app runtime, and
  // migrations need the host's direct (unpooled) connection.
  url: process.env.DATABASE_URL_UNPOOLED,
});
