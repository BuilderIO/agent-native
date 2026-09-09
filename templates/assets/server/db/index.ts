import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

for (const type of ["asset-library", "image-library"] as const) {
  registerShareableResource({
    type,
    resourceTable: schema.assetLibraries,
    sharesTable: schema.assetLibraryShares,
    displayName: "Asset Library",
    titleColumn: "title",
    getResourcePath: (library) => `/library/${library.id}`,
    getDb,
  });
}

registerShareableResource({
  type: "asset-template",
  resourceTable: schema.assetTemplates,
  sharesTable: schema.assetTemplateShares,
  displayName: "Template",
  titleColumn: "title",
  getResourcePath: (template) => `/templates/${template.id}`,
  getDb,
});
