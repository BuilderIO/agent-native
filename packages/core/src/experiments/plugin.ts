import { registerExperiments, type ExperimentDefinition } from "./registry.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** A tiny startup plugin for app-local, explicit experiment registration. */
export function createExperimentsPlugin(options: {
  experiments: readonly ExperimentDefinition[];
}): NitroPluginDef {
  return async () => {
    registerExperiments(options.experiments);
  };
}
