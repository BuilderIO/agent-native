import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "delivery_work_item",
  resourceTable: schema.workItems,
  sharesTable: schema.workItemShares,
  displayName: "Delivery work item",
  titleColumn: "title",
  getResourcePath: (workItem) => `/work-items/${workItem.id}`,
  getDb,
  allowPublic: false,
});

registerShareableResource({
  type: "delivery_routing_rule",
  resourceTable: schema.routingRules,
  sharesTable: schema.routingRuleShares,
  displayName: "Delivery routing rule",
  titleColumn: "name",
  getResourcePath: (rule) => `/routing-rules/${rule.id}`,
  getDb,
  allowPublic: false,
});
