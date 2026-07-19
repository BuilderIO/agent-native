import { defineEventHandler } from "h3";

import { handlePrivateVaultMigrationEvidence } from "../../../../lib/private-vault-migration-evidence-route.js";

export default defineEventHandler(handlePrivateVaultMigrationEvidence);
