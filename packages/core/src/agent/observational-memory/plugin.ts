import { isProductionServerlessFunctionRuntime } from "../../db/migration-runtime.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
} from "../../server/framework-request-handler.js";
import { observationalMemoryStore } from "./store.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createObservationalMemoryPlugin(): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "observational-memory");
    await awaitBootstrap(nitroApp);
    // Request functions initialize optional memory storage at its first use,
    // rather than making every page/action wait for unrelated schema work.
    if (!isProductionServerlessFunctionRuntime())
      await observationalMemoryStore.ready();
  };
}

export const defaultObservationalMemoryPlugin: NitroPluginDef =
  createObservationalMemoryPlugin();
