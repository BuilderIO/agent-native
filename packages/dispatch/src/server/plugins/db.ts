import { runMigrations } from "@agent-native/core/db";

import { dispatchMigrations } from "../../db/migrations.js";
import { scheduleVaultBootResync } from "../lib/vault-boot-resync.js";

export const runDispatchMigrations = runMigrations(dispatchMigrations, {
  table: "dispatch_migrations",
});

export default async (nitroApp: any) => {
  await runDispatchMigrations(nitroApp);
  scheduleVaultBootResync();
};
