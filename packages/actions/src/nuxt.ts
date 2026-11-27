import { generateActionArtifacts } from "./codegen.js";

export interface NuxtActionsModuleOptions {
  actionsDir?: string;
  generatedDir?: string;
}

interface NuxtLike {
  options?: {
    rootDir?: string;
  };
  hook?: (name: string, fn: () => void | Promise<void>) => void;
}

/**
 * Lightweight Nuxt module that runs deterministic `.generated/actions.ts` and
 * `.generated/action-types.d.ts` codegen during Nuxt prepare and build.
 */
export default function agentNativeActionsNuxtModule(
  moduleOptions: NuxtActionsModuleOptions = {},
  nuxt?: NuxtLike,
): void {
  const projectRoot = nuxt?.options?.rootDir ?? process.cwd();
  const run = () => {
    generateActionArtifacts({
      projectRoot,
      ...(moduleOptions.actionsDir
        ? { actionsDir: moduleOptions.actionsDir }
        : {}),
      ...(moduleOptions.generatedDir
        ? { generatedDir: moduleOptions.generatedDir }
        : {}),
    });
  };

  run();
  nuxt?.hook?.("prepare:types", run);
  nuxt?.hook?.("build:before", run);
}
