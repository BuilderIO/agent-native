import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "migration-run",
  resourceTable: schema.migrationRuns,
  sharesTable: schema.migrationRunShares,
  displayName: "Migration Run",
  titleColumn: "name",
  getResourcePath: (run) => `/runs/${run.id}`,
  getDb,
});
