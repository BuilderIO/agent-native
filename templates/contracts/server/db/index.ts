import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "contract",
  resourceTable: schema.contracts,
  sharesTable: schema.contractShares,
  displayName: "Contract",
  titleColumn: "title",
  getResourcePath: (contract) => `/contracts/${contract.id}`,
  getDb,
});
