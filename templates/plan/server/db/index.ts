import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import { resolvePlanAccessContext } from "../lib/local-identity.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "plan",
  resourceTable: schema.plans,
  sharesTable: schema.planShares,
  displayName: "Plan",
  titleColumn: "title",
  getResourcePath: (plan) =>
    (plan as { kind?: string }).kind === "recap"
      ? `/recaps/${plan.id}`
      : `/plans/${plan.id}`,
  getDb,
  resolveAccessContext: resolvePlanAccessContext,
});
