import * as schema from "./schema.js";
import { createGetDb, getDbExec } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema, getDbExec };

registerShareableResource({
  type: "recording",
  resourceTable: schema.recordings,
  sharesTable: schema.recordingShares,
  displayName: "Recording",
  titleColumn: "title",
  getDb,
});
