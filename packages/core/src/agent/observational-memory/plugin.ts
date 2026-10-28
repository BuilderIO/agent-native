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
    await observationalMemoryStore.ready();
  };
}

export const defaultObservationalMemoryPlugin: NitroPluginDef =
  createObservationalMemoryPlugin();
