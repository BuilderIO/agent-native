import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestOrgId,
  getRequestStableUserId,
} from "@agent-native/core/server/request-context";

import { CONTENT_PRIVATE_VAULT_MIGRATION_FLAG } from "../../shared/private-vault-feature-flags.js";
import { sqlPrivateVaultMigrationSource } from "./private-vault-migration-source.js";
import { sqlPrivateVaultMigrationStore } from "./private-vault-migration-store.js";
import { privateVaultMigrationCiphertextTarget } from "./private-vault-migration-target.js";
import { PrivateVaultMigrationCoordinator } from "./private-vault-migration.js";
import {
  PrivateVaultObjectNotFoundError,
  requirePrivateVaultActionScope,
} from "./private-vault-objects.js";

export const privateVaultMigrationCoordinator =
  new PrivateVaultMigrationCoordinator(
    sqlPrivateVaultMigrationSource,
    privateVaultMigrationCiphertextTarget,
    sqlPrivateVaultMigrationStore,
  );

export async function requirePrivateVaultMigrationActionScope(vaultId: string) {
  const scope = await requirePrivateVaultActionScope(vaultId);
  const userId = getRequestStableUserId();
  const orgId = getRequestOrgId();
  if (
    !userId ||
    !orgId ||
    !(await isFeatureFlagEnabled(CONTENT_PRIVATE_VAULT_MIGRATION_FLAG, {
      userEmail: scope.ownerEmail,
      userKey: userId,
      orgId,
    }))
  )
    throw new PrivateVaultObjectNotFoundError();
  return scope;
}

export async function getPrivateVaultMigration(
  scope: Awaited<ReturnType<typeof requirePrivateVaultMigrationActionScope>>,
  migrationId: string,
) {
  const current = await sqlPrivateVaultMigrationStore.get(scope, migrationId);
  if (!current) throw new PrivateVaultObjectNotFoundError();
  return current;
}
