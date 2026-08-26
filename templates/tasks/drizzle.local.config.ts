import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

export default createDrizzleConfig({
  dialect: "sqlite",
  sqliteFile: "./data/app.db",
});
