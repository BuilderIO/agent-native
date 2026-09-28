import { createLabsPlugin } from "../labs/plugin.js";
import type { ExperimentDefinition } from "./registry.js";

/** @deprecated Import and call createLabsPlugin instead. */
export function createExperimentsPlugin(options: {
  experiments: readonly ExperimentDefinition[];
}) {
  return createLabsPlugin({ labs: options.experiments });
}
