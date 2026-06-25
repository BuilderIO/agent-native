import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "form",
  resourceTable: schema.forms,
  sharesTable: schema.formShares,
  displayName: "Form",
  titleColumn: "title",
  getResourcePath: (form) => `/forms/${form.id}`,
  getDb,
});
