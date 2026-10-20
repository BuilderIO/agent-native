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
    await contextXrayStore.ready();
  };
}

export const defaultContextXrayPlugin: NitroPluginDef =
  createContextXrayPlugin();
