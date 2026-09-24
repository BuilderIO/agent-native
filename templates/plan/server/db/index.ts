import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  PLAN_AGENT_CONTEXT_ENDPOINT,
  PLAN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
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
  agentReadable: {
    resourceKind: PLAN_AGENT_RESOURCE_KIND,
    getContextPath: () => PLAN_AGENT_CONTEXT_ENDPOINT,
    getPagePath: (plan) =>
      (plan as { kind?: string }).kind === "recap"
        ? `/recaps/${plan.id}`
        : `/plans/${plan.id}`,
  },
  getDb,
  resolveAccessContext: resolvePlanAccessContext,
});
