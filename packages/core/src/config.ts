/**
 * Public, non-secret configuration for an Agent-Native app.
 *
 * This module is intentionally free of Node and framework imports so it can be
 * used from a typed `agent-native.config.ts` file and from browser code after Vite
 * serializes the resolved config into the client bundle.
 */

export const AGENT_NATIVE_CONFIG_VERSION = 1 as const;

export type AgentNativeFirstRunOnboardingMode =
  | "off"
  | "connect"
  | "connect-and-integrations";

export type AgentNativeFirstRunOnboardingSetting =
  | AgentNativeFirstRunOnboardingMode
  | (Partial<Record<string, AgentNativeFirstRunOnboardingMode>> & {
      default?: AgentNativeFirstRunOnboardingMode;
    });

export interface AgentNativeOnboardingConfig {
  /**
   * First-run setup shown by the shared Agent Sidebar.
   *
   * `connect` shows Builder/BYOK setup and skips the generic integrations
   * catalog. `connect-and-integrations` includes that catalog. A per-Vite-mode
   * object is useful when local development and hosted builds need different
   * defaults.
   */
  firstRun?: AgentNativeFirstRunOnboardingSetting;
}

export interface AgentNativeRuntimeAuthConfig {
  /** Whether the app expects the framework or a custom auth layer to run. */
  enabled?: boolean;
}

export interface AgentNativeRuntimeDatabaseConfig {
  /** Whether production needs a persistent remote database. */
  required?: boolean;
}

export interface AgentNativeRuntimeEnvironmentConfig {
  /** Additional non-secret environment keys required by this app. */
  required?: string[];
}

export interface AgentNativeRuntimeConfig {
  auth?: AgentNativeRuntimeAuthConfig;
  database?: AgentNativeRuntimeDatabaseConfig;
  environment?: AgentNativeRuntimeEnvironmentConfig;
}

export type AgentNativeDeploymentEnvironment =
  | "local"
  | "beta"
  | "production"
  | "preview";

export interface AgentNativeDeploymentConfig {
  /** The release lane that produced the currently running client bundle. */
  environment?: AgentNativeDeploymentEnvironment;
}

export interface AgentNativeDiagnosticsConfig {
  /** Fail a production Vite build when runtime configuration has issues. */
  failOnBuild?: boolean;
}

export interface AgentNativeInstructionsConfig {
  /** Relative Markdown file loaded by the in-app runtime agent. */
  runtime?: string;
  /** Relative Markdown file loaded by development/coding agents. */
  development?: string;
}

export interface AgentNativeTranslationsConfig {
  /**
   * Locales the app intentionally ships translations for. `en-US` is the
   * default source locale; additional locales are opt-in.
   */
  locales?: string[];
}

export interface AgentNativeChangelogConfig {
  /** Whether agents should create and surface user-facing changelog entries. */
  enabled?: boolean;
}

export type AgentNativeHarnessRuntime =
  | "claude-code"
  | "codex"
  | "pi"
  | "opencode";

export interface AgentNativeHarnessConfig {
  /** Optionally narrow the hosted harness picker to these runtimes. */
  runtimes?: AgentNativeHarnessRuntime[];
}

/**
 * The intentionally small app-level switch for hosted tools-only harnesses.
 * `true` enables every supported runtime; an object narrows the picker.
 */
export type AgentNativeHarnessSetting = boolean | AgentNativeHarnessConfig;

export interface AgentNativeConfig {
  version?: typeof AGENT_NATIVE_CONFIG_VERSION;
  onboarding?: AgentNativeOnboardingConfig;
  runtime?: AgentNativeRuntimeConfig;
  deployment?: AgentNativeDeploymentConfig;
  diagnostics?: AgentNativeDiagnosticsConfig;
  instructions?: AgentNativeInstructionsConfig;
  translations?: AgentNativeTranslationsConfig;
  changelog?: AgentNativeChangelogConfig;
  harness?: AgentNativeHarnessSetting;
}

export interface AgentNativeConfigContext {
  command: "serve" | "build";
  mode: string;
  isDev: boolean;
  isBuild: boolean;
}

export type AgentNativeConfigFactory = (
  context: AgentNativeConfigContext,
) => AgentNativeConfig;

export type AgentNativeConfigInput =
  | AgentNativeConfig
  | AgentNativeConfigFactory;

/**
 * Type-safe authoring helper for `agent-native.config.ts`.
 *
 * Like Next's typed config file, this is deliberately identity-like: the
 * framework evaluates the exported object or factory in the Vite config
 * phase, while the browser only receives the resolved serializable result.
 */
export function defineAgentNativeConfig(
  config: AgentNativeConfigInput,
): AgentNativeConfigInput {
  return config;
}

export const AGENT_NATIVE_CONFIG_ENV_PREFIX = "AGENT_NATIVE_CONFIG" as const;

type AgentNativeConfigEnvKind =
  | "array"
  | "boolean"
  | "deployment-environment"
  | "number"
  | "object"
  | "string"
  | "union";

interface AgentNativeConfigEnvNode {
  path: readonly string[];
  kind: AgentNativeConfigEnvKind;
  aliases?: readonly string[];
  dynamicObjectKeys?: boolean;
}

/**
 * Serializable public config nodes that may be initialized from the
 * deployment environment. Object nodes accept JSON fragments, which lets a
 * deploy set a whole section without requiring a separate alias for every
 * leaf. Dynamic keys in the onboarding mode map stay JSON-only at the union
 * node because they are not part of the fixed config shape.
 */
const AGENT_NATIVE_CONFIG_ENV_NODES: readonly AgentNativeConfigEnvNode[] = [
  { path: [], kind: "object" },
  { path: ["version"], kind: "number" },
  { path: ["onboarding"], kind: "object" },
  {
    path: ["onboarding", "firstRun"],
    kind: "union",
    dynamicObjectKeys: true,
  },
  { path: ["runtime"], kind: "object" },
  { path: ["runtime", "auth"], kind: "object" },
  { path: ["runtime", "auth", "enabled"], kind: "boolean" },
  { path: ["runtime", "database"], kind: "object" },
  { path: ["runtime", "database", "required"], kind: "boolean" },
  { path: ["runtime", "environment"], kind: "object" },
  {
    path: ["runtime", "environment", "required"],
    kind: "array",
  },
  { path: ["deployment"], kind: "object" },
  {
    path: ["deployment", "environment"],
    kind: "deployment-environment",
  },
  { path: ["diagnostics"], kind: "object" },
  { path: ["diagnostics", "failOnBuild"], kind: "boolean" },
  { path: ["instructions"], kind: "object" },
  { path: ["instructions", "runtime"], kind: "string" },
  { path: ["instructions", "development"], kind: "string" },
  { path: ["translations"], kind: "object" },
  { path: ["translations", "locales"], kind: "array" },
  { path: ["changelog"], kind: "object" },
  { path: ["changelog", "enabled"], kind: "boolean" },
  { path: ["harness"], kind: "union" },
  { path: ["harness", "runtimes"], kind: "array" },
];

function agentNativeConfigEnvSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}

/** Convert a config path such as `runtime.auth.enabled` to its env name. */
export function agentNativeConfigEnvName(path: readonly string[]): string {
  if (path.length === 0) return AGENT_NATIVE_CONFIG_ENV_PREFIX;
  return `${AGENT_NATIVE_CONFIG_ENV_PREFIX}_${path
    .map(agentNativeConfigEnvSegment)
    .join("_")}`;
}

function agentNativeConfigEnvKeys(node: AgentNativeConfigEnvNode): string[] {
  return [agentNativeConfigEnvName(node.path), ...(node.aliases ?? [])];
}

function isAgentNativeConfigEnvKey(key: string): boolean {
  return (
    key === AGENT_NATIVE_CONFIG_ENV_PREFIX ||
    key.startsWith(`${AGENT_NATIVE_CONFIG_ENV_PREFIX}_`)
  );
}

function parseAgentNativeConfigJson(raw: string, key: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${key} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseAgentNativeConfigEnvValue(
  raw: string,
  key: string,
  kind: AgentNativeConfigEnvKind,
): unknown {
  const value = raw.trim();
  switch (kind) {
    case "object": {
      const parsed = parseAgentNativeConfigJson(value, key);
      if (!isRecord(parsed)) {
        throw new Error(`${key} must contain a JSON object`);
      }
      return parsed;
    }
    case "array": {
      const parsed = parseAgentNativeConfigJson(value, key);
      if (!Array.isArray(parsed)) {
        throw new Error(`${key} must contain a JSON array`);
      }
      return parsed;
    }
    case "boolean": {
      const normalized = value.toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
      throw new Error(`${key} must be a boolean`);
    }
    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
      return parsed;
    }
    case "deployment-environment":
      return value.toLowerCase();
    case "string": {
      if (value.startsWith('"')) {
        const parsed = parseAgentNativeConfigJson(value, key);
        if (typeof parsed !== "string") {
          throw new Error(`${key} must contain a string`);
        }
        return parsed;
      }
      return value;
    }
    case "union": {
      if (value.startsWith("{") || value.startsWith("[")) {
        return parseAgentNativeConfigJson(value, key);
      }
      const normalized = value.toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
      if (value.startsWith('"')) {
        const parsed = parseAgentNativeConfigJson(value, key);
        if (typeof parsed !== "string") {
          throw new Error(`${key} must contain a string or JSON object`);
        }
        return parsed;
      }
      return value;
    }
  }
}

function agentNativeConfigEnvNodeForPath(
  path: readonly string[],
): AgentNativeConfigEnvNode | undefined {
  return AGENT_NATIVE_CONFIG_ENV_NODES.find(
    (node) =>
      node.path.length === path.length &&
      node.path.every((segment, index) => segment === path[index]),
  );
}

function agentNativeConfigEnvChildren(
  path: readonly string[],
): AgentNativeConfigEnvNode[] {
  return AGENT_NATIVE_CONFIG_ENV_NODES.filter(
    (node) =>
      node.path.length === path.length + 1 &&
      path.every((segment, index) => node.path[index] === segment),
  );
}

function validateAgentNativeConfigEnvFragment(
  value: unknown,
  path: readonly string[],
  key: string,
): void {
  const node = agentNativeConfigEnvNodeForPath(path);
  if (!node) return;

  if (node.kind === "object") {
    if (!isRecord(value)) {
      throw new Error(`${key} must contain a JSON object`);
    }
  } else if (node.kind !== "union" || !isRecord(value)) {
    return;
  }

  if (node.dynamicObjectKeys) return;

  const children = new Map(
    agentNativeConfigEnvChildren(path).map((child) => [
      child.path[child.path.length - 1],
      child,
    ]),
  );
  for (const [childKey, childValue] of Object.entries(value)) {
    const child = children.get(childKey);
    if (!child) {
      const childPath = [...path, childKey].join(".");
      throw new Error(
        `${key} contains unsupported Agent-Native config path ${childPath}`,
      );
    }
    validateAgentNativeConfigEnvFragment(childValue, child.path, key);
  }
}

function mergeAgentNativeConfigEnvFragments(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] =
      isRecord(existing) && isRecord(value)
        ? mergeAgentNativeConfigEnvFragments(existing, value)
        : value;
  }
  return result;
}

function assignAgentNativeConfigEnvFragment(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
  key: string,
): void {
  if (path.length === 0) {
    if (!isRecord(value)) {
      throw new Error(`${key} must contain a JSON object`);
    }
    Object.assign(target, mergeAgentNativeConfigEnvFragments(target, value));
    return;
  }

  let node = target;
  for (const segment of path.slice(0, -1)) {
    const existing = node[segment];
    if (existing === undefined) {
      node[segment] = {};
    } else if (!isRecord(existing)) {
      node[segment] = {};
    }
    node = node[segment] as Record<string, unknown>;
  }

  const leaf = path[path.length - 1];
  const existing = node[leaf];
  node[leaf] =
    isRecord(existing) && isRecord(value)
      ? mergeAgentNativeConfigEnvFragments(existing, value)
      : value;
}

/**
 * Reads the public config's deterministic environment aliases.
 *
 * `AGENT_NATIVE_CONFIG` contains a complete JSON object. A suffixed name
 * contains a JSON fragment at that config path, or a typed scalar at a leaf.
 * Nodes are applied from shallowest to deepest so a more specific path wins.
 */
export function readAgentNativeConfigEnv(
  env: Record<string, string | undefined>,
): AgentNativeConfig {
  const known = new Map<string, AgentNativeConfigEnvNode>();
  for (const node of AGENT_NATIVE_CONFIG_ENV_NODES) {
    for (const key of agentNativeConfigEnvKeys(node)) {
      const previous = known.get(key);
      if (previous && previous.path.join(".") !== node.path.join(".")) {
        throw new Error(`Duplicate Agent-Native config environment key ${key}`);
      }
      known.set(key, node);
    }
  }

  for (const key of Object.keys(env)) {
    if (isAgentNativeConfigEnvKey(key) && !known.has(key)) {
      throw new Error(
        `${key} is not a supported Agent-Native config path. Use agent-native.config.ts or a documented config env alias.`,
      );
    }
  }

  const layer: Record<string, unknown> = {};
  const nodes = [...AGENT_NATIVE_CONFIG_ENV_NODES].sort(
    (left, right) => left.path.length - right.path.length,
  );
  for (const node of nodes) {
    for (const key of agentNativeConfigEnvKeys(node)) {
      const raw = env[key];
      if (raw === undefined || raw.trim() === "") continue;
      const value = parseAgentNativeConfigEnvValue(raw, key, node.kind);
      validateAgentNativeConfigEnvFragment(value, node.path, key);
      assignAgentNativeConfigEnvFragment(layer, node.path, value, key);
      break;
    }
  }

  return normalizeAgentNativeConfig(layer, "Agent-Native config environment");
}

export function normalizeAgentNativeConfig(
  input: unknown,
  source = "agent-native config",
): AgentNativeConfig {
  if (!isRecord(input)) {
    throw new Error(`${source} must export an object`);
  }

  if (
    input.version !== undefined &&
    input.version !== AGENT_NATIVE_CONFIG_VERSION
  ) {
    throw new Error(
      `${source}.version must be ${AGENT_NATIVE_CONFIG_VERSION} when provided`,
    );
  }

  const onboardingValue = input.onboarding;
  const runtimeValue = input.runtime;
  const deploymentValue = input.deployment;
  const diagnosticsValue = input.diagnostics;
  const instructionsValue = input.instructions;
  const translationsValue = input.translations;
  const changelogValue = input.changelog;
  const harnessValue = input.harness;

  const normalized: AgentNativeConfig = {
    ...(input.version === undefined
      ? {}
      : { version: AGENT_NATIVE_CONFIG_VERSION }),
  };

  if (onboardingValue !== undefined) {
    if (!isRecord(onboardingValue)) {
      throw new Error(`${source}.onboarding must be an object`);
    }
    const firstRun = normalizeFirstRunSetting(
      onboardingValue.firstRun,
      `${source}.onboarding.firstRun`,
    );
    normalized.onboarding = firstRun === undefined ? {} : { firstRun };
  }

  if (runtimeValue !== undefined) {
    normalized.runtime = normalizeRuntimeConfig(
      runtimeValue,
      `${source}.runtime`,
    );
  }

  if (deploymentValue !== undefined) {
    normalized.deployment = normalizeDeploymentConfig(
      deploymentValue,
      `${source}.deployment`,
    );
  }

  if (diagnosticsValue !== undefined) {
    normalized.diagnostics = normalizeDiagnosticsConfig(
      diagnosticsValue,
      `${source}.diagnostics`,
    );
  }

  if (instructionsValue !== undefined) {
    normalized.instructions = normalizeInstructionsConfig(
      instructionsValue,
      `${source}.instructions`,
    );
  }

  if (translationsValue !== undefined) {
    normalized.translations = normalizeTranslationsConfig(
      translationsValue,
      `${source}.translations`,
    );
  }

  if (changelogValue !== undefined) {
    normalized.changelog = normalizeChangelogConfig(
      changelogValue,
      `${source}.changelog`,
    );
  }

  if (harnessValue !== undefined) {
    normalized.harness = normalizeHarnessConfig(
      harnessValue,
      `${source}.harness`,
    );
  }

  return normalized;
}

export function mergeAgentNativeConfigs(
  base: AgentNativeConfig,
  override: AgentNativeConfig,
): AgentNativeConfig {
  return {
    ...(base.version === undefined && override.version === undefined
      ? {}
      : {
          version:
            override.version ?? base.version ?? AGENT_NATIVE_CONFIG_VERSION,
        }),
    onboarding:
      base.onboarding || override.onboarding
        ? {
            ...base.onboarding,
            ...override.onboarding,
          }
        : undefined,
    runtime:
      base.runtime || override.runtime
        ? {
            ...base.runtime,
            ...override.runtime,
            auth:
              base.runtime?.auth || override.runtime?.auth
                ? {
                    ...base.runtime?.auth,
                    ...override.runtime?.auth,
                  }
                : undefined,
            database:
              base.runtime?.database || override.runtime?.database
                ? {
                    ...base.runtime?.database,
                    ...override.runtime?.database,
                  }
                : undefined,
            environment:
              base.runtime?.environment || override.runtime?.environment
                ? {
                    ...base.runtime?.environment,
                    ...override.runtime?.environment,
                    required: mergeStringLists(
                      base.runtime?.environment?.required,
                      override.runtime?.environment?.required,
                    ),
                  }
                : undefined,
          }
        : undefined,
    deployment:
      base.deployment || override.deployment
        ? {
            ...base.deployment,
            ...override.deployment,
          }
        : undefined,
    diagnostics:
      base.diagnostics || override.diagnostics
        ? {
            ...base.diagnostics,
            ...override.diagnostics,
          }
        : undefined,
    instructions:
      base.instructions || override.instructions
        ? {
            ...base.instructions,
            ...override.instructions,
          }
        : undefined,
    translations:
      base.translations || override.translations
        ? {
            ...base.translations,
            ...override.translations,
            ...(override.translations?.locales === undefined &&
            base.translations?.locales === undefined
              ? {}
              : {
                  locales:
                    override.translations?.locales ??
                    base.translations?.locales,
                }),
          }
        : undefined,
    changelog:
      base.changelog || override.changelog
        ? {
            ...base.changelog,
            ...override.changelog,
          }
        : undefined,
    harness: mergeHarnessSettings(base.harness, override.harness),
  };
}

export function resolveAgentNativeConfig(
  input: AgentNativeConfigInput | undefined,
  context: AgentNativeConfigContext,
): AgentNativeConfig {
  const value = typeof input === "function" ? input(context) : (input ?? {});
  const normalized = normalizeAgentNativeConfig(value);
  const firstRun = normalized.onboarding?.firstRun;

  if (firstRun === undefined) return normalized;

  return {
    ...normalized,
    onboarding: {
      ...normalized.onboarding,
      firstRun: resolveFirstRunOnboardingMode(firstRun, context),
    },
  };
}

export function resolveFirstRunOnboardingMode(
  setting: AgentNativeFirstRunOnboardingSetting,
  context: AgentNativeConfigContext,
): AgentNativeFirstRunOnboardingMode {
  if (typeof setting === "string") return setting;

  const modeValue = setting[context.mode];
  if (modeValue !== undefined) return modeValue;

  const environmentValue =
    setting[context.command === "serve" ? "development" : "production"];
  return environmentValue ?? setting.default ?? "off";
}

function normalizeFirstRunSetting(
  value: unknown,
  source: string,
): AgentNativeFirstRunOnboardingSetting | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (!isFirstRunMode(value)) {
      throw new Error(
        `${source} must be "off", "connect", or "connect-and-integrations"`,
      );
    }
    return value;
  }
  if (!isRecord(value)) {
    throw new Error(`${source} must be a mode string or a mode map`);
  }

  const result: Record<string, AgentNativeFirstRunOnboardingMode> = {};
  for (const [key, mode] of Object.entries(value)) {
    if (!isFirstRunMode(mode)) {
      throw new Error(
        `${source}.${key} must be "off", "connect", or "connect-and-integrations"`,
      );
    }
    result[key] = mode;
  }
  return result;
}

function normalizeRuntimeConfig(
  value: unknown,
  source: string,
): AgentNativeRuntimeConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }

  const result: AgentNativeRuntimeConfig = {};
  for (const section of ["auth", "database", "environment"] as const) {
    const sectionValue = value[section];
    if (sectionValue === undefined) continue;
    if (!isRecord(sectionValue)) {
      throw new Error(`${source}.${section} must be an object`);
    }

    if (section === "environment") {
      const required = normalizeRequiredEnvKeys(
        sectionValue.required,
        `${source}.environment.required`,
      );
      result.environment = required === undefined ? {} : { required };
      continue;
    }

    const field = section === "auth" ? "enabled" : "required";
    const fieldValue = sectionValue[field];
    if (fieldValue !== undefined && typeof fieldValue !== "boolean") {
      throw new Error(`${source}.${section}.${field} must be a boolean`);
    }
    result[section] = fieldValue === undefined ? {} : { [field]: fieldValue };
  }
  return result;
}

function normalizeDeploymentConfig(
  value: unknown,
  source: string,
): AgentNativeDeploymentConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }
  const environment = value.environment;
  if (environment === undefined) return {};
  if (!isAgentNativeDeploymentEnvironment(environment)) {
    throw new Error(
      `${source}.environment must be "local", "beta", "production", or "preview"`,
    );
  }
  return { environment };
}

function normalizeDiagnosticsConfig(
  value: unknown,
  source: string,
): AgentNativeDiagnosticsConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }
  if (
    value.failOnBuild !== undefined &&
    typeof value.failOnBuild !== "boolean"
  ) {
    throw new Error(`${source}.failOnBuild must be a boolean`);
  }
  return value.failOnBuild === undefined
    ? {}
    : { failOnBuild: value.failOnBuild };
}

function normalizeInstructionsConfig(
  value: unknown,
  source: string,
): AgentNativeInstructionsConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }

  const result: AgentNativeInstructionsConfig = {};
  for (const audience of ["runtime", "development"] as const) {
    const pathValue = value[audience];
    if (pathValue === undefined) continue;
    if (typeof pathValue !== "string") {
      throw new Error(`${source}.${audience} must be a relative file path`);
    }
    result[audience] = normalizeRelativeFilePath(
      pathValue,
      `${source}.${audience}`,
    );
  }
  return result;
}

function normalizeTranslationsConfig(
  value: unknown,
  source: string,
): AgentNativeTranslationsConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }
  const locales = value.locales;
  if (locales === undefined) return {};
  if (
    !Array.isArray(locales) ||
    locales.some((locale) => typeof locale !== "string")
  ) {
    throw new Error(`${source}.locales must be an array of locale codes`);
  }
  const normalized = locales.map((locale) => locale.trim());
  if (normalized.some((locale) => !locale)) {
    throw new Error(`${source}.locales must contain non-empty locale codes`);
  }
  return { locales: [...new Set(normalized)] };
}

function normalizeChangelogConfig(
  value: unknown,
  source: string,
): AgentNativeChangelogConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`${source}.enabled must be a boolean`);
  }
  return value.enabled === undefined ? {} : { enabled: value.enabled };
}

function normalizeHarnessConfig(
  value: unknown,
  source: string,
): AgentNativeHarnessSetting {
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) {
    throw new Error(`${source} must be a boolean or object`);
  }
  if ("enabled" in value || "ui" in value) {
    throw new Error(`${source} must be true or an object with runtimes`);
  }

  const runtimes = value.runtimes;
  if (runtimes !== undefined) {
    if (
      !Array.isArray(runtimes) ||
      runtimes.some((runtime) => !isAgentNativeHarnessRuntime(runtime))
    ) {
      throw new Error(
        `${source}.runtimes must contain only "claude-code", "codex", "pi", or "opencode"`,
      );
    }
  }

  return {
    ...(runtimes === undefined
      ? {}
      : { runtimes: [...new Set(runtimes as AgentNativeHarnessRuntime[])] }),
  };
}

function mergeHarnessSettings(
  base: AgentNativeHarnessSetting | undefined,
  override: AgentNativeHarnessSetting | undefined,
): AgentNativeHarnessSetting | undefined {
  if (override === undefined) return base;
  if (typeof override === "boolean") return override;
  if (typeof base !== "object" || base === null) return override;
  if (base.runtimes === undefined && override.runtimes === undefined) {
    return {};
  }
  return {
    runtimes: [
      ...new Set<AgentNativeHarnessRuntime>([
        ...(base.runtimes ?? []),
        ...(override.runtimes ?? []),
      ]),
    ],
  };
}

function normalizeRelativeFilePath(value: string, source: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(
      `${source} must be a non-empty relative file path inside the app root`,
    );
  }
  return normalized;
}

function normalizeRequiredEnvKeys(
  value: unknown,
  source: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string")) {
    throw new Error(`${source} must be an array of environment variable names`);
  }
  const keys = value.map((key) => key.trim());
  if (keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    throw new Error(`${source} must contain valid environment variable names`);
  }
  return [...new Set(keys)];
}

function mergeStringLists(
  base: string[] | undefined,
  override: string[] | undefined,
): string[] | undefined {
  if (base === undefined && override === undefined) return undefined;
  return [...new Set([...(base ?? []), ...(override ?? [])])];
}

function isFirstRunMode(
  value: unknown,
): value is AgentNativeFirstRunOnboardingMode {
  return (
    value === "off" ||
    value === "connect" ||
    value === "connect-and-integrations"
  );
}

function isAgentNativeHarnessRuntime(
  value: unknown,
): value is AgentNativeHarnessRuntime {
  return (
    value === "claude-code" ||
    value === "codex" ||
    value === "pi" ||
    value === "opencode"
  );
}

export function isAgentNativeDeploymentEnvironment(
  value: unknown,
): value is AgentNativeDeploymentEnvironment {
  return (
    value === "local" ||
    value === "beta" ||
    value === "production" ||
    value === "preview"
  );
}

/**
 * Resolve the public deployment lane from hosting facts at build time.
 *
 * Netlify exposes `CONTEXT` and `BRANCH` to builds. Keeping this inference in
 * the Vite/config boundary means browser code consumes typed public config and
 * never parses process.env itself.
 */
export function inferAgentNativeDeploymentEnvironment(
  env: Record<string, string | undefined>,
  mode?: string,
): AgentNativeDeploymentEnvironment | undefined {
  const explicit =
    env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();
  if (explicit && !isAgentNativeDeploymentEnvironment(explicit)) {
    throw new Error(
      'AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT must be "local", "beta", "production", or "preview"',
    );
  }
  if (isAgentNativeDeploymentEnvironment(explicit)) return explicit;

  const context = env.CONTEXT?.trim().toLowerCase();
  const branch = env.BRANCH?.trim().toLowerCase();
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();

  if (
    branch === "production" ||
    (context === "production" && branch !== "beta")
  ) {
    return "production";
  }
  if (branch === "beta" || (context === "branch-deploy" && branch === "main")) {
    return "beta";
  }
  if (vercelEnv === "preview") return "preview";
  if (
    context === "deploy-preview" ||
    context === "branch-deploy" ||
    branch?.startsWith("deploy-preview")
  ) {
    return "preview";
  }
  if (mode === "development") return "local";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
