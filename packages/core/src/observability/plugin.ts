import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import {
  getH3App,
  awaitBootstrap,
} from "../server/framework-request-handler.js";
import { startTraceCleanupJob } from "./cleanup-job.js";
import { createObservabilityHandler } from "./routes.js";
import { ensureObservabilityTables } from "./store.js";

export function createObservabilityPlugin() {
  return async (nitroApp: any) => {
    await awaitBootstrap(nitroApp);
    await ensureObservabilityTables().catch(() => {});
    getH3App(nitroApp).use(
      `${FRAMEWORK_ROUTE_PREFIX}/observability`,
      createObservabilityHandler(),
    );
    try {
      startTraceCleanupJob();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[observability] Failed to start trace cleanup job:",
        (err as any)?.message ?? err,
      );
    }
  };
}
