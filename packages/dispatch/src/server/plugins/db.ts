import { runMigrations } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";

import { dispatchMigrations } from "../../db/migrations.js";
import { scheduleVaultBootResync } from "../lib/vault-boot-resync.js";

registerIdentityColumns([
  {
    table: "dispatch_identity_links",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason:
      "A linked chat identity acts as its owner; transferring it would let the departed member act as the successor.",
  },
  {
    table: "dispatch_link_tokens",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason:
      "An unclaimed link token binds a chat identity to its owner; the successor mints their own.",
  },
  {
    table: "identity_sso_authorization_code",
    column: "email",
    emailChange: "delete",
    offboard: "delete",
    reason:
      "Unconsumed single-use code that asserts this address to an app; the member signs in again.",
  },
  {
    table: "identity_sso_bootstrap",
    column: "email",
    emailChange: "delete",
    offboard: "delete",
    reason:
      "Unconsumed single-use sign-in bootstrap for this address; the member signs in again.",
  },
  ...[
    "dispatch_destinations",
    "dispatch_dreams",
    "dispatch_link_tokens",
    "vault_secrets",
    "workspace_resources",
  ].map((table) => ({
    table,
    column: "created_by",
    emailChange: "retain" as const,
    offboard: "retain" as const,
    reason: "Creator attribution; ownership is owner_email.",
  })),
]);

export const runDispatchMigrations = runMigrations(dispatchMigrations, {
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
