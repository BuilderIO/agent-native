import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

// Keep the schema helpers and migration metadata on the primary deployment
// dialect when generation runs without a database URL.
export default createDrizzleConfig({ dialect: "postgresql" });
