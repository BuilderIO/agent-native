import {
  getH3App,
  awaitBootstrap,
} from "../server/framework-request-handler.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
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
  };
}
