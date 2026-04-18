import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

// Register "call" as a shareable resource — the framework auto-mounts
// share-resource / set-resource-visibility / list-resource-shares for us.
registerShareableResource({
  type: "call",
  resourceTable: schema.calls,
  sharesTable: schema.callShares,
  displayName: "Call",
  titleColumn: "title",
  getDb,
});

// Snippets are separately shareable — a snippet inherits its parent call's
// permissions by default but can be shared independently (narrower or wider).
registerShareableResource({
  type: "snippet",
  resourceTable: schema.snippets,
  sharesTable: schema.snippetShares,
  displayName: "Snippet",
  titleColumn: "title",
  getDb,
});
