import { autoMountAuth } from "./auth.js";
import type { AuthOptions } from "./auth.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createAuthPlugin(options?: AuthOptions): NitroPluginDef {
  return (nitroApp: any) => {
    autoMountAuth(nitroApp.h3App, options);
  };
}

export const defaultAuthPlugin: NitroPluginDef = createAuthPlugin();
