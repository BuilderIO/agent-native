import { registerLabs, type LabDefinition } from "./registry.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** A tiny startup plugin for app-local, explicit lab registration. */
export function createLabsPlugin(options: {
  labs: readonly LabDefinition[];
}): NitroPluginDef {
  return async () => {
    registerLabs(options.labs);
  };
}
