import "dotenv/config";
import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

export default createDrizzleConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  url: process.env.DATABASE_URL_UNPOOLED,
});
