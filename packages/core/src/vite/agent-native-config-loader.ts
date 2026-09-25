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
import { parseHostedHarnessBuildValue } from "../server/hosted-harness-build-mode.js";

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
 * The first-run onboarding mode to embed into the Nitro server bundle, derived
 * from the same resolved config and env the client bundle is built from, so the
 * server's eligibility-marker gate cannot disagree with what the client shows.
 * "" (unknown) when neither configures onboarding: the server then keeps
 * writing the marker rather than guessing "off".
 */
export function resolveFirstRunOnboardingBuildReplacement(
  config: AgentNativeConfig,
  env: Record<string, string | undefined>,
): AgentNativeFirstRunOnboardingMode | "" {
  const envOverride = env[FIRST_RUN_ONBOARDING_ENV_OVERRIDE_KEY];
  const configured = config.onboarding?.firstRun as
    | AgentNativeFirstRunOnboardingMode
    | undefined;
  if (envOverride === undefined && configured === undefined) return "";
  return resolveEffectiveFirstRunOnboardingMode(envOverride, configured);
}

/**
 * The hosted harness setting to embed into the Nitro server bundle. Unlike
 * first-run onboarding, harness has no separate client env override, so the
 * fully resolved config value is always the final word — `config.harness` is
 * never ambiguous the way an un-configured first-run mode is. JSON-encoded so
 * "not configured" (`null`) stays distinct from the empty-string sentinel
 * `hosted-harness-build-mode.ts` uses for "a build recorded nothing".
 */
export function resolveHarnessBuildReplacement(
  config: AgentNativeConfig,
): string {
  return JSON.stringify(config.harness ?? null);
}

const AGENT_NATIVE_BUILD_CONFIG_MARKER = path.join(
  ".agent-native",
  "build-config.json",
);

export interface AgentNativeBuildConfigMarker {
  firstRunOnboarding: AgentNativeFirstRunOnboardingMode | "";
  /** The JSON-encoded return value of `resolveHarnessBuildReplacement`. */
  harness: string;
}

const FIRST_RUN_ONBOARDING_MARKER_VALUES = new Set<string>([
  "",
  "off",
  "connect",
  "connect-and-integrations",
]);

/**
 * `agent-native build` runs the Vite build and the deploy (Nitro) build as
 * separate processes, and only the Vite build sees config passed inline to
 * `agentNative()`. The Vite build records every build-time value it resolved
 * here so the deploy build embeds the same values (one handoff file for every
 * value the deploy build cannot re-derive on its own).
 */
export function writeAgentNativeBuildConfigMarker(
  cwd: string,
  marker: AgentNativeBuildConfigMarker,
): void {
  const filePath = path.join(cwd, AGENT_NATIVE_BUILD_CONFIG_MARKER);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(marker));
}

/** Called before each `agent-native build` so a marker can only come from this build's Vite step. */
export function clearAgentNativeBuildConfigMarker(cwd: string): void {
  fs.rmSync(path.join(cwd, AGENT_NATIVE_BUILD_CONFIG_MARKER), {
    force: true,
  });
}

/** `undefined` when no Vite build recorded a marker (older core, or a build that skipped the Vite step). */
export function readAgentNativeBuildConfigMarker(
  cwd: string,
): AgentNativeBuildConfigMarker | undefined {
  const filePath = path.join(cwd, AGENT_NATIVE_BUILD_CONFIG_MARKER);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid agent-native build config marker: ${filePath}`, {
      cause: error,
    });
  }
  const record = parsed as Partial<AgentNativeBuildConfigMarker> | null;
  if (
    !record ||
    typeof record !== "object" ||
    !FIRST_RUN_ONBOARDING_MARKER_VALUES.has(
      record.firstRunOnboarding as string,
    ) ||
    typeof record.harness !== "string"
  ) {
    throw new Error(`Invalid agent-native build config marker: ${filePath}`);
  }
  try {
    parseHostedHarnessBuildValue(record.harness);
  } catch (error) {
    throw new Error(`Invalid agent-native build config marker: ${filePath}`, {
      cause: error,
    });
  }
  return {
    firstRunOnboarding: record.firstRunOnboarding!,
    harness: record.harness,
  };
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
