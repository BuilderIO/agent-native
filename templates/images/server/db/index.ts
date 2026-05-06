import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "image-library",
  resourceTable: schema.imageLibraries,
  sharesTable: schema.imageLibraryShares,
  displayName: "Image Library",
  titleColumn: "title",
  getDb,
});
