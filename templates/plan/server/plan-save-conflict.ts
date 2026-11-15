import { saveConflict } from "@agent-native/core/save-conflict/server";

import { loadPlanBundle } from "./plans.js";

/** The one typed conflict for a stale plan write, carrying the plan as it is now. */
export async function planSaveConflict(planId: string) {
  const { plan } = await loadPlanBundle(planId);
  return saveConflict("plan_content", plan.content, plan.updatedAt);
}
