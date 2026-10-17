import { runAuthGuard } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import { isLocalPlanRuntime } from "../lib/local-identity.js";
import { PUBLIC_PLAN_ACTION_PATHS } from "../lib/public-action-paths.js";

const PUBLIC_PLAN_REVIEW_ACTIONS: ReadonlySet<string> = new Set(
  PUBLIC_PLAN_ACTION_PATHS,
);

export default defineEventHandler(async (event) => {
  const path = (event.node?.req?.url ?? event.path ?? "/").split("?")[0] ?? "/";
  if (PUBLIC_PLAN_REVIEW_ACTIONS.has(path)) return;
  // In local mode all action paths are open — the action handlers gate ownership
  // via requirePlanOwnerEmailForWrite (returns the local identity) so there is no
  // security gap; this path can never be reached on a hosted/production deploy.
  if (isLocalPlanRuntime() && path.startsWith("/_agent-native/actions/"))
    return;
  return runAuthGuard(event);
});
