/**
 * Global auth middleware — runs for ALL requests (page routes, API routes,
 * framework routes). The auth plugin configures the guard; this middleware
 * enforces it on every request.
 */
import { defineEventHandler } from "h3";
import { runAuthGuard } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  return runAuthGuard(event);
});
