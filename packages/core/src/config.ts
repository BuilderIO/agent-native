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

export type AgentNativeHarnessUi = "default" | "desktop";

export interface AgentNativeHarnessConfig {
  /** Declare that this app can expose the hosted, tools-only harness UI. */
  enabled?: boolean;
  /** Hosted harness labels shown in the agent picker. */
  runtimes?: AgentNativeHarnessRuntime[];
  /** Use the Electron-style left rail and always-open chat surface. */
  ui?: AgentNativeHarnessUi;
}

export interface AgentNativeConfig {
  version?: typeof AGENT_NATIVE_CONFIG_VERSION;
  onboarding?: AgentNativeOnboardingConfig;
  runtime?: AgentNativeRuntimeConfig;
  diagnostics?: AgentNativeDiagnosticsConfig;
  instructions?: AgentNativeInstructionsConfig;
  translations?: AgentNativeTranslationsConfig;
  changelog?: AgentNativeChangelogConfig;
  harness?: AgentNativeHarnessConfig;
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
    harness:
      base.harness || override.harness
        ? {
            ...base.harness,
            ...override.harness,
            ...(base.harness?.runtimes !== undefined ||
            override.harness?.runtimes !== undefined
              ? {
                  runtimes: mergeHarnessRuntimes(
                    base.harness?.runtimes,
                    override.harness?.runtimes,
                  ),
                }
              : {}),
          }
        : undefined,
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
): AgentNativeHarnessConfig {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object`);
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`${source}.enabled must be a boolean`);
  }
  if (value.ui !== undefined && value.ui !== "default" && value.ui !== "desktop") {
    throw new Error(`${source}.ui must be "default" or "desktop"`);
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
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    ...(value.ui === undefined ? {} : { ui: value.ui }),
    ...(runtimes === undefined
      ? {}
      : { runtimes: [...new Set(runtimes as AgentNativeHarnessRuntime[])] }),
  };
}

function mergeHarnessRuntimes(
  base: AgentNativeHarnessRuntime[] | undefined,
  override: AgentNativeHarnessRuntime[] | undefined,
): AgentNativeHarnessRuntime[] | undefined {
  if (base === undefined && override === undefined) return undefined;
  return [
    ...new Set<AgentNativeHarnessRuntime>([
      ...(base ?? []),
      ...(override ?? []),
    ]),
  ];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
