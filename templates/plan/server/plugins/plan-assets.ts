import { getH3App, awaitBootstrap } from "@agent-native/core/server";

import { createPlanAssetHandler } from "../plan-asset-route.js";

/**
 * Mounts the plan-asset serving route.
 *
 *   GET /_agent-native/plan-asset/<assetId>/<filename>
 *
 * Access inherits the parent plan's visibility: public plans allow anonymous
 * fetch; private/org plans require a session or bearer token.
 */
export default async function planAssetsPlugin(nitroApp: any) {
  await awaitBootstrap(nitroApp);
  getH3App(nitroApp).use("/_agent-native/plan-asset", createPlanAssetHandler());
}
