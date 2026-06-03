/**
 * Global auth middleware — runs for ALL requests (page routes, API routes,
 * framework routes). The auth plugin configures the guard; this middleware
 * enforces it on every request.
 *
 * Without this, auth only runs for /_agent-native/* routes because the
 * framework handler's middleware registry is scoped to that catch-all.
 * Page routes (/, /settings) and API routes (/api/*) would bypass auth.
 */
import { defineEventHandler } from "h3";
import { runAuthGuard } from "@agent-native/core/server";

const PUBLIC_PLAN_REVIEW_ACTIONS = new Set([
  "/_agent-native/actions/get-visual-plan",
  "/_agent-native/actions/update-visual-plan",
  "/_agent-native/actions/export-visual-plan",
]);

export default defineEventHandler(async (event) => {
  const path = (event.node?.req?.url ?? event.path ?? "/").split("?")[0] ?? "/";
  if (PUBLIC_PLAN_REVIEW_ACTIONS.has(path)) return;
  return runAuthGuard(event);
});
