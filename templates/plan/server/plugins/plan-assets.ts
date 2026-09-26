import { getH3App, awaitBootstrap } from "@agent-native/core/server";

import { createPlanAssetHandler } from "../plan-asset-route.js";

export default async function planAssetsPlugin(nitroApp: any) {
  await awaitBootstrap(nitroApp);
  getH3App(nitroApp).use("/_agent-native/plan-asset", createPlanAssetHandler());
}
