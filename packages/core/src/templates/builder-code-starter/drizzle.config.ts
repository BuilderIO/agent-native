import "dotenv/config";
import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

export default createDrizzleConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  url:
    // config-ok: drizzle-kit loads this file outside the app runtime, and
    // migrations need the host's direct (unpooled) connection.
    process.env.DATABASE_URL_UNPOOLED ||
    // config-ok: Netlify DB's name for the same direct connection.
    process.env.NETLIFY_DATABASE_URL_UNPOOLED,
});
