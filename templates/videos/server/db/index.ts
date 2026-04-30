import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "composition",
  resourceTable: schema.compositions,
  sharesTable: schema.compositionShares,
  displayName: "Composition",
  titleColumn: "title",
  getDb,
});

registerShareableResource({
  type: "design-system",
  resourceTable: schema.designSystems,
  sharesTable: schema.designSystemShares,
  displayName: "Design System",
  titleColumn: "title",
  getDb,
});

registerShareableResource({
  type: "folder",
  resourceTable: schema.folders,
  sharesTable: schema.folderShares,
  displayName: "Folder",
  titleColumn: "name",
  getDb,
});
