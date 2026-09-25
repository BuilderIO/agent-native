import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  FIRST_RUN_ONBOARDING_ENV_OVERRIDE_KEY,
  mergeAgentNativeConfigs,
  normalizeAgentNativeConfig,
  readAgentNativeConfigEnv,
  resolveAgentNativeConfig,
  resolveEffectiveFirstRunOnboardingMode,
  type AgentNativeConfig,
  type AgentNativeConfigContext,
  type AgentNativeConfigInput,
  type AgentNativeFirstRunOnboardingMode,
} from "../config.js";

/** The canonical filename comes first; the remaining names stay compatible. */
export const AGENT_NATIVE_CONFIG_FILE_CANDIDATES = [
  "agent-native.config.ts",
  "agent-native.ts",
  "agent-native.mts",
  "agent-native.config.mts",
] as const;

export function createAgentNativeConfigContext(
  command: AgentNativeConfigContext["command"] | undefined,
  mode: string,
): AgentNativeConfigContext {
  const resolvedCommand = command === "build" ? "build" : "serve";
  return {
    command: resolvedCommand,
    mode,
    isDev: resolvedCommand === "serve",
    isBuild: resolvedCommand === "build",
  };
}

export function readAgentNativeJsonConfig(cwd: string): AgentNativeConfig {
  const configPath = path.join(cwd, "agent-native.json");
  if (!fs.existsSync(configPath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return normalizeAgentNativeConfig(parsed, configPath);
}

export async function loadAgentNativeConfigFile(
  cwd: string,
): Promise<AgentNativeConfigInput | undefined> {
  const configPath = findConfigPath(cwd);
  if (!configPath) return undefined;

  try {
    const module = (await import(pathToFileURL(configPath).href)) as {
      default?: unknown;
      agentNativeConfig?: unknown;
    };
    const config = module.default ?? module.agentNativeConfig;
    if (typeof config !== "object" && typeof config !== "function") {
      throw new Error("the default export must be an object or function");
    }
    return config as AgentNativeConfigInput;
  } catch (error) {
    throw new Error(
      `Could not load ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Load the optional config owned by the workspace root. App-local config is
 * loaded separately so each app can override the shared policy without a
 * generated copy of the file.
 */
export async function loadWorkspaceAgentNativeConfigFile(
  cwd: string,
): Promise<AgentNativeConfigInput | undefined> {
  const workspaceRoot = findWorkspaceRoot(cwd);
  if (!workspaceRoot || workspaceRoot === path.resolve(cwd)) return undefined;
  const configPath = findConfigPath(workspaceRoot);
  if (!configPath) return undefined;

  try {
    const module = (await import(pathToFileURL(configPath).href)) as {
      default?: unknown;
      agentNativeConfig?: unknown;
    };
    const config = module.default ?? module.agentNativeConfig;
    if (typeof config !== "object" && typeof config !== "function") {
      throw new Error("the default export must be an object or function");
    }
    return config as AgentNativeConfigInput;
  } catch (error) {
    throw new Error(
      `Could not load ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadResolvedAgentNativeConfig(
  cwd: string,
  context: AgentNativeConfigContext,
  options: {
    environment?: Record<string, string | undefined>;
    loadProjectConfig?: boolean;
    projectConfig?: AgentNativeConfigInput;
  } = {},
): Promise<AgentNativeConfig> {
  const workspaceConfig =
    options.loadProjectConfig === false
      ? undefined
      : await loadWorkspaceAgentNativeConfigFile(cwd);
  const projectConfig =
    options.projectConfig ??
    (options.loadProjectConfig === false
      ? undefined
      : await loadAgentNativeConfigFile(cwd));

  return resolveAgentNativeConfig(
    mergeAgentNativeConfigs(
      mergeAgentNativeConfigs(
        mergeAgentNativeConfigs(
          workspaceConfig
            ? resolveAgentNativeConfig(workspaceConfig, context)
            : {},
          readAgentNativeJsonConfig(cwd),
        ),
        projectConfig ? resolveAgentNativeConfig(projectConfig, context) : {},
      ),
      readAgentNativeConfigEnv(options.environment ?? process.env),
      { arrayStrategy: "replace" },
    ),
    context,
  );
}

/**
 * Resolves the first-run onboarding mode to embed into the Nitro server bundle
 * at build time (`vite/client.ts` Nitro `replace`, `deploy/build.ts`
 * `resolveNitroBuildReplacements`). Synchronous so both callers can use it.
 * Returns "" (unknown) whenever it cannot see the whole config, so the server
 * keeps writing the eligibility marker rather than silently turning onboarding
 * off for an app configured somewhere this reader does not look.
 */
export function resolveFirstRunOnboardingBuildReplacement(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): AgentNativeFirstRunOnboardingMode | "" {
  try {
    const envOverride = env[FIRST_RUN_ONBOARDING_ENV_OVERRIDE_KEY];
    if (envOverride !== undefined) {
      return resolveEffectiveFirstRunOnboardingMode(envOverride, undefined);
    }
    // A TS config is merged after agent-native.json and cannot be loaded
    // synchronously, so it could enable onboarding without this reader seeing
    // it. Claim a mode only when agent-native.json plus config env vars are the
    // last word; otherwise report unknown so the server keeps writing the marker.
    if (findConfigPath(cwd)) return "";
    const mode = env.NODE_ENV === "development" ? "development" : "production";
    const config = resolveAgentNativeConfig(
      mergeAgentNativeConfigs(
        readAgentNativeJsonConfig(cwd),
        readAgentNativeConfigEnv(env),
        { arrayStrategy: "replace" },
      ),
      createAgentNativeConfigContext("build", mode),
    );
    const configured = config.onboarding?.firstRun as
      | AgentNativeFirstRunOnboardingMode
      | undefined;
    if (configured === undefined) return "";
    return resolveEffectiveFirstRunOnboardingMode(undefined, configured);
    // coercion-ok: "" is a distinct "unknown" sentinel, not a guessed "off".
  } catch {
    return "";
  }
}

function findConfigPath(cwd: string): string | undefined {
  return AGENT_NATIVE_CONFIG_FILE_CANDIDATES.map((filename) =>
    path.join(cwd, filename),
  ).find((candidate) => fs.existsSync(candidate));
}

function findWorkspaceRoot(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (packageJson["agent-native"]?.workspaceCore) return current;
      } catch (error) {
        throw new Error(
          `Could not read workspace manifest ${packagePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
