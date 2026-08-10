import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  mergeAgentNativeConfigs,
  normalizeAgentNativeConfig,
  resolveAgentNativeConfig,
  type AgentNativeConfig,
  type AgentNativeConfigContext,
  type AgentNativeConfigInput,
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
  const configPath = AGENT_NATIVE_CONFIG_FILE_CANDIDATES.map((filename) =>
    path.join(cwd, filename),
  ).find((candidate) => fs.existsSync(candidate));
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
    loadProjectConfig?: boolean;
    projectConfig?: AgentNativeConfigInput;
  } = {},
): Promise<AgentNativeConfig> {
  const projectConfig =
    options.projectConfig ??
    (options.loadProjectConfig === false
      ? undefined
      : await loadAgentNativeConfigFile(cwd));

  return resolveAgentNativeConfig(
    mergeAgentNativeConfigs(
      readAgentNativeJsonConfig(cwd),
      projectConfig ? resolveAgentNativeConfig(projectConfig, context) : {},
    ),
    context,
  );
}
