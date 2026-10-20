import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { requireFormsPermission } from "../lib/app-roles.js";
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
  persistVisibilityChange: async ({ resourceId, update, userEmail, orgId }) => {
    await requireFormsPermission("forms.edit", "id")(
      { id: resourceId },
      { userEmail, orgId },
    );
    await getDb()
      .update(schema.forms)
      .set(update)
      .where(eq(schema.forms.id, resourceId));
  },
});
