import { isProductionServerlessFunctionRuntime } from "../../db/migration-runtime.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
} from "../../server/framework-request-handler.js";
import { contextXrayStore } from "./schema-store.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createContextXrayPlugin(): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "context-xray");
    await awaitBootstrap(nitroApp);
    // Request functions initialize optional memory storage at its first use,
    // rather than making every page/action wait for unrelated schema work.
    if (!isProductionServerlessFunctionRuntime())
      await contextXrayStore.ready();
  };
}

export const defaultContextXrayPlugin: NitroPluginDef =
  createContextXrayPlugin();
