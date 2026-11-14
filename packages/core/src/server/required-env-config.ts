import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";
import { readRequiredEnvBuildConfig } from "./required-env-build.js";

/**
 * The env var names the app declares under `runtime.environment.required`, for
 * the configuration probe. A build embeds them (see `required-env-build.ts`).
 * The dev server reads them from the app's config instead: Nitro's dev runtime
 * loads an npm-installed core without the build's replacements, the same reason
 * `loadHostedHarnessConfig` falls back to a disk read.
 */
export async function loadRequiredEnv(cwd = process.cwd()): Promise<string[]> {
  const build = readRequiredEnvBuildConfig();
  if (build.recorded) return build.names;

  const production = process.env.NODE_ENV === "production";
  const config = await loadResolvedAgentNativeConfig(
    cwd,
    createAgentNativeConfigContext(
      production ? "build" : "serve",
      production ? "production" : "development",
    ),
  );
  return config.runtime?.environment?.required ?? [];
}
