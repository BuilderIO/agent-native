import { sqlPrivateVaultMigrationEvidenceStore } from "./private-vault-migration-evidence-store.js";
import { PrivateVaultMigrationEvidenceService } from "./private-vault-migration-evidence.js";
import { sqlPrivateVaultMigrationStore } from "./private-vault-migration-store.js";

export const privateVaultMigrationEvidenceService =
  new PrivateVaultMigrationEvidenceService({
    migrations: sqlPrivateVaultMigrationStore,
    evidence: sqlPrivateVaultMigrationEvidenceStore,
  });
