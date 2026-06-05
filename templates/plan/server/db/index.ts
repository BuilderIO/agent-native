import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "plan",
  resourceTable: schema.plans,
  sharesTable: schema.planShares,
  displayName: "Plan",
  titleColumn: "title",
  getResourcePath: (plan) => `/plans/${plan.id}`,
  getDb,
});
