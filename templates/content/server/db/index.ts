import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "document",
  resourceTable: schema.documents,
  sharesTable: schema.documentShares,
  displayName: "Document",
  titleColumn: "title",
  getDb,
});
