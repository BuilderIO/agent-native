import { defineAction } from "@agent-native/core/action";

import {
  approvalOperationalSchema,
  migrationAudit,
  runMigration,
  type MigrationInput,
} from "./migrate-content-database-rows.js";

export default defineAction({
  description:
    "Rollback an applied Content database row migration or finalize its legacy properties. Requires approval and the exact expected post-migration digest.",
  schema: approvalOperationalSchema,
  needsApproval: true,
  audit: migrationAudit,
  run: (args) => runMigration(args as MigrationInput),
});
