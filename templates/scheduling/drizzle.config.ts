import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

export default createDrizzleConfig({ sqliteFile: "./data/scheduling.db" });
