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
import { rootDispatchRedirect } from "../lib/pre-auth-routing.js";

export default defineEventHandler(async (event) => {
  const redirectOrReserved = rootDispatchRedirect(
    event.url.pathname,
    event.url.search,
  );
  if (redirectOrReserved) return redirectOrReserved;

  return runAuthGuard(event);
});
