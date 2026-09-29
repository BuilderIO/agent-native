import path from "node:path";

import { getAppConfig } from "../app-config/index.js";
import {
  BUILTIN_AGENT_CATALOG_IDS,
  DEFAULT_BUILTIN_AGENT_IDS,
  normalizeAgentId,
} from "../shared/first-party-agents.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";
import { findWorkspaceRoot, readJson } from "./workspace-root.js";

export type BuiltinAgentsMode = "all" | "none" | "selected";

export interface BuiltinAgentsConfig {
  mode: BuiltinAgentsMode;
  /** Built-ins this workspace offers. Anything else is unknown to it. */
  include: string[];
  /** Offered built-ins an organization starts with before an admin changes them. */
  defaultEnabled: string[];
}

export const BUILTIN_AGENTS_ENV_KEY = "AGENT_NATIVE_BUILTIN_AGENTS_JSON";
export const BUILTIN_AGENTS_ENABLED_SETTINGS_KEY = "builtin-agents-enabled";

export function frameworkDefaultBuiltinAgentsConfig(): BuiltinAgentsConfig {
  return {
    mode: "all",
    include: [...DEFAULT_BUILTIN_AGENT_IDS],
    defaultEnabled: [...DEFAULT_BUILTIN_AGENT_IDS],
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
    return { config: { mode, include: [], defaultEnabled: [] }, warnings };
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

  const requestedDefaults = parseIdList(
    record.defaultEnabled,
    "builtinAgents.defaultEnabled",
    warnings,
  );
  const defaultEnabled =
    requestedDefaults === undefined
      ? [...include]
      : requestedDefaults.filter((id) => {
          if (include.includes(id)) return true;
          warnings.push(
            `builtinAgents.defaultEnabled names "${id}", which is not offered by include`,
          );
          return false;
        });

  return { config: { mode, include, defaultEnabled }, warnings };
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

export interface BuiltinAgentsEnabledSettings {
  enabledIds: string[];
  /** The builder's include list when this was saved; newer offerings use defaultEnabled. */
  offeredIds?: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface BuiltinAgentsSettingsScope {
  kind: "org" | "user";
  id: string;
}

export function currentBuiltinAgentsSettingsScope(): BuiltinAgentsSettingsScope | null {
  const orgId = getRequestOrgId();
  if (orgId) return { kind: "org", id: orgId };
  const email = getRequestUserEmail();
  if (email) return { kind: "user", id: email };
  return null;
}

function parseStoredIds(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Invalid ${BUILTIN_AGENTS_ENABLED_SETTINGS_KEY}.${field}`);
  }
  return [...new Set(value.map((id: string) => normalizeAgentId(id)))];
}

export function parseBuiltinAgentsEnabledSettings(
  raw: unknown,
): BuiltinAgentsEnabledSettings | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid ${BUILTIN_AGENTS_ENABLED_SETTINGS_KEY} setting`);
  }
  const record = raw as Record<string, unknown>;
  return {
    enabledIds: parseStoredIds(record.enabledIds, "enabledIds"),
    ...(record.offeredIds !== undefined
      ? { offeredIds: parseStoredIds(record.offeredIds, "offeredIds") }
      : {}),
    ...(typeof record.updatedAt === "string"
      ? { updatedAt: record.updatedAt }
      : {}),
    ...(typeof record.updatedBy === "string"
      ? { updatedBy: record.updatedBy }
      : {}),
  };
}

/** Returns null when no admin has changed the setting; throws when it is unreadable. */
export async function readBuiltinAgentsEnabledSettings(
  scope: BuiltinAgentsSettingsScope | null = currentBuiltinAgentsSettingsScope(),
): Promise<BuiltinAgentsEnabledSettings | null> {
  if (!scope) return null;
  const { getOrgSetting, getUserSetting } =
    await import("../settings/index.js");
  const raw =
    scope.kind === "org"
      ? await getOrgSetting(scope.id, BUILTIN_AGENTS_ENABLED_SETTINGS_KEY)
      : await getUserSetting(scope.id, BUILTIN_AGENTS_ENABLED_SETTINGS_KEY);
  return parseBuiltinAgentsEnabledSettings(raw);
}

export function resolveEnabledBuiltinAgentIds(
  config: BuiltinAgentsConfig,
  settings: BuiltinAgentsEnabledSettings | null,
): string[] {
  if (!settings) return [...config.defaultEnabled];
  return config.include.filter((id) =>
    !settings.offeredIds || settings.offeredIds.includes(id)
      ? settings.enabledIds.includes(id)
      : config.defaultEnabled.includes(id),
  );
}

/** Builder include ∩ admin setting for the current request's org (or user). */
export async function readEnabledBuiltinAgentIds(
  config: BuiltinAgentsConfig = readBuiltinAgentsConfig(),
): Promise<string[]> {
  if (config.include.length === 0) return [];
  return resolveEnabledBuiltinAgentIds(
    config,
    await readBuiltinAgentsEnabledSettings(),
  );
}

export class BuiltinAgentsNotOfferedError extends Error {
  statusCode = 400;
  constructor(readonly ids: string[]) {
    super(
      `Built-in app(s) not offered by this workspace: ${ids.join(", ")}. Use list-builtin-agents to see which built-ins can be enabled.`,
    );
    this.name = "BuiltinAgentsNotOfferedError";
  }
}

export async function writeBuiltinAgentsEnabledSettings(input: {
  scope: BuiltinAgentsSettingsScope;
  enabledIds: string[];
  actor: string;
  config?: BuiltinAgentsConfig;
}): Promise<BuiltinAgentsEnabledSettings> {
  const config = input.config ?? readBuiltinAgentsConfig();
  const enabledIds = [
    ...new Set(
      input.enabledIds.map((id) => normalizeAgentId(id)).filter(Boolean),
    ),
  ];
  const notOffered = enabledIds.filter((id) => !config.include.includes(id));
  if (notOffered.length > 0) throw new BuiltinAgentsNotOfferedError(notOffered);

  const next: BuiltinAgentsEnabledSettings = {
    enabledIds: config.include.filter((id) => enabledIds.includes(id)),
    offeredIds: [...config.include],
    updatedAt: new Date().toISOString(),
    updatedBy: input.actor,
  };
  const { putOrgSetting, putUserSetting } =
    await import("../settings/index.js");
  const value = next as unknown as Record<string, unknown>;
  if (input.scope.kind === "org") {
    await putOrgSetting(
      input.scope.id,
      BUILTIN_AGENTS_ENABLED_SETTINGS_KEY,
      value,
    );
  } else {
    await putUserSetting(
      input.scope.id,
      BUILTIN_AGENTS_ENABLED_SETTINGS_KEY,
      value,
    );
  }
  return next;
}
