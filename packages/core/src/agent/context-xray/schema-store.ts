import { defineStore } from "../../db/store-registry.js";
import { fromMigrationEntries } from "../../db/versioned-store-migrations.js";
import { CONTEXT_XRAY_MIGRATIONS } from "./migrations.js";

export const contextXrayStore = defineStore({
  id: "context_xray",
  migrations: fromMigrationEntries(
    "_context_xray_migrations",
    CONTEXT_XRAY_MIGRATIONS,
    { ranAtBoot: true },
  ),
});
