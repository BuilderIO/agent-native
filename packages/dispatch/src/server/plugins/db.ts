import { runMigrations } from "@agent-native/core/db";

import { dispatchMigrations } from "../../db/migrations.js";
import { scheduleVaultBootResync } from "../lib/vault-boot-resync.js";

const runDispatchMigrations = runMigrations(dispatchMigrations, {
  table: "dispatch_migrations",
});

/**
 * Run dispatch's own migrations first (this is what guarantees
 * `vault_secrets` exists), then kick off the vault boot resync. The resync
 * itself waits several more seconds before touching the DB — see
 * vault-boot-resync.ts — so this ordering is a belt-and-suspenders
 * guarantee, not a hard dependency.
 */
export default async (nitroApp: any) => {
  await runDispatchMigrations(nitroApp);
  scheduleVaultBootResync();
};
