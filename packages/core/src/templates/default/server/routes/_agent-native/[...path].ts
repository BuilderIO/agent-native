import { defineEventHandler } from "h3";
import { handleFrameworkRequest } from "@agent-native/core/server";

/**
 * Catch-all route for all /_agent-native/* framework endpoints.
 * Nitro discovers this file automatically. The actual routing and
 * handler dispatch is done by the framework's request handler,
 * which loads plugins and registers routes on first request.
 */
export default defineEventHandler(async (event) => {
  return handleFrameworkRequest(event);
});
