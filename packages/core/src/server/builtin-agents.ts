import path from "node:path";

import { getAppConfig } from "../app-config/index.js";
import {
  BUILTIN_AGENT_CATALOG_IDS,
  DEFAULT_BUILTIN_AGENT_IDS,
  normalizeAgentId,
} from "../shared/first-party-agents.js";
import { findWorkspaceRoot, readJson } from "./workspace-root.js";

export type BuiltinAgentsMode = "all" | "none" | "selected";

export interface BuiltinAgentsConfig {
  mode: BuiltinAgentsMode;
  /** Built-ins this workspace offers. Anything else is unknown to it. */
  include: string[];
}

export const BUILTIN_AGENTS_ENV_KEY = "AGENT_NATIVE_BUILTIN_AGENTS_JSON";

export function frameworkDefaultBuiltinAgentsConfig(): BuiltinAgentsConfig {
  return {
    mode: "all",
    include: [...DEFAULT_BUILTIN_AGENT_IDS],
  };
}

function parseIdList(
  value: unknown,
  field: string,
  warnings: string[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(`${field} must be an array of built-in agent ids`);
    return undefined;
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      warnings.push(`${field} contains a non-string entry`);
      continue;
    }
    const id = normalizeAgentId(entry);
    if (!BUILTIN_AGENT_CATALOG_IDS.includes(id)) {
      warnings.push(`${field} names unknown built-in agent "${entry}"`);
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function parseBuiltinAgentsConfig(raw: unknown): {
  config: BuiltinAgentsConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) {
    return { config: frameworkDefaultBuiltinAgentsConfig(), warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("builtinAgents must be an object; using the default");
    return { config: frameworkDefaultBuiltinAgentsConfig(), warnings };
  }
  const record = raw as Record<string, unknown>;
  const mode = record.mode ?? "all";
  if (mode !== "all" && mode !== "none" && mode !== "selected") {
    warnings.push(
      `builtinAgents.mode must be "all", "none", or "selected"; using the default`,
    );
    return { config: frameworkDefaultBuiltinAgentsConfig(), warnings };
  }
  if (mode === "none") {
    return { config: { mode, include: [] }, warnings };
  }

  let include: string[];
  if (mode === "all") {
    if (record.include !== undefined) {
      warnings.push(`builtinAgents.include is ignored when mode is "all"`);
    }
    include = [...DEFAULT_BUILTIN_AGENT_IDS];
  } else {
    if (record.include === undefined) {
      warnings.push(
        `builtinAgents.include is required when mode is "selected"`,
      );
    }
    include =
      parseIdList(record.include, "builtinAgents.include", warnings) ?? [];
  }

  return { config: { mode, include }, warnings };
}

function readRawBuiltinAgentsConfig(): {
  raw: unknown;
  source: string | null;
} {
  const envJson = getAppConfig().workspace.builtinAgentsJson;
  if (envJson) {
    try {
      return { raw: JSON.parse(envJson), source: BUILTIN_AGENTS_ENV_KEY };
    } catch {
      // A malformed value is reported by the parser as a non-object config.
      return { raw: envJson, source: BUILTIN_AGENTS_ENV_KEY };
    }
  }

  let cwd: string;
  try {
    cwd = process.cwd();
  } catch {
    return { raw: undefined, source: null };
  }
  const packageFile = path.join(findWorkspaceRoot(cwd) ?? cwd, "package.json");
  const raw = readJson(packageFile)?.["agent-native"]?.builtinAgents;
  return raw === undefined
    ? { raw: undefined, source: null }
    : { raw, source: packageFile };
}

/** Serialized `agent-native.builtinAgents` for child app processes, if configured. */
export function workspaceBuiltinAgentsJson(
  workspaceRoot: string,
): string | undefined {
  const envJson = getAppConfig().workspace.builtinAgentsJson;
  if (envJson) return envJson;
  const raw = readJson(path.join(workspaceRoot, "package.json"))?.[
    "agent-native"
  ]?.builtinAgents;
  return raw === undefined ? undefined : JSON.stringify(raw);
}

let cachedConfig: { key: string; config: BuiltinAgentsConfig } | undefined;

/**
 * The app builder's `agent-native.builtinAgents` config, read from
 * AGENT_NATIVE_BUILTIN_AGENTS_JSON or the workspace root (or standalone app)
 * package.json. Absent config means `mode: "all"`.
 */
export function readBuiltinAgentsConfig(): BuiltinAgentsConfig {
  let cwd = "";
  try {
    cwd = process.cwd();
  } catch {
    // coercion-ok: edge runtimes without a cwd rely on the env value.
  }
  const key = `${getAppConfig().workspace.builtinAgentsJson ?? ""}\0${cwd}`;
  if (cachedConfig?.key === key) return cachedConfig.config;

  const { raw, source } = readRawBuiltinAgentsConfig();
  const { config, warnings } = parseBuiltinAgentsConfig(raw);
  for (const warning of warnings) {
    console.warn(`[builtin-agents] ${warning} (${source ?? "default"})`);
  }
  cachedConfig = { key, config };
  return config;
}

export function resetBuiltinAgentsConfigForTests(): void {
  cachedConfig = undefined;
}
