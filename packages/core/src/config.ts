/**
 * Public, non-secret configuration for an Agent-Native app.
 *
 * This module is intentionally free of Node and framework imports so it can be
 * used from a typed `agent-native.config.ts` file and from browser code after
 * Vite serializes the resolved config into the client bundle.
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

export interface AgentNativeConfig {
  version?: typeof AGENT_NATIVE_CONFIG_VERSION;
  onboarding?: AgentNativeOnboardingConfig;
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
  if (onboardingValue === undefined) {
    return input.version === undefined
      ? {}
      : { version: AGENT_NATIVE_CONFIG_VERSION };
  }
  if (!isRecord(onboardingValue)) {
    throw new Error(`${source}.onboarding must be an object`);
  }

  const firstRun = normalizeFirstRunSetting(
    onboardingValue.firstRun,
    `${source}.onboarding.firstRun`,
  );

  return {
    ...(input.version === undefined
      ? {}
      : { version: AGENT_NATIVE_CONFIG_VERSION }),
    onboarding: firstRun === undefined ? {} : { firstRun },
  };
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

function isFirstRunMode(
  value: unknown,
): value is AgentNativeFirstRunOnboardingMode {
  return (
    value === "off" ||
    value === "connect" ||
    value === "connect-and-integrations"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
