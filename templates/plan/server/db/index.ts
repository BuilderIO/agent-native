import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  PLAN_AGENT_CONTEXT_ENDPOINT,
  PLAN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import { planPathForKind } from "../../shared/plan-routes.js";
import type { PlanKind } from "../../shared/types.js";
import { resolvePlanAccessContext } from "../lib/local-identity.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

/**
 * `plans.kind` is NOT NULL with a `plan` default, so the row always carries a
 * real kind — the cast is the registration boundary's loose typing, not a
 * guard against a missing value.
 */
function planResourcePath(plan: unknown): string {
  const row = plan as { id: string; kind: PlanKind };
  return planPathForKind(row.id, row.kind);
}

registerShareableResource({
  type: "plan",
  resourceTable: schema.plans,
  sharesTable: schema.planShares,
  displayName: "Plan",
  titleColumn: "title",
  getResourcePath: planResourcePath,
  agentReadable: {
    resourceKind: PLAN_AGENT_RESOURCE_KIND,
    getContextPath: () => PLAN_AGENT_CONTEXT_ENDPOINT,
    getPagePath: planResourcePath,
  },
  getDb,
  resolveAccessContext: resolvePlanAccessContext,
});
