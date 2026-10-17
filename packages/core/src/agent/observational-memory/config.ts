export const DEFAULT_OBSERVATION_TOKEN_THRESHOLD = 30_000;

export const DEFAULT_REFLECTION_TOKEN_THRESHOLD = 40_000;

export const DEFAULT_RECENT_RAW_MESSAGE_COUNT = 12;

export const DEFAULT_OBSERVATION_MAX_OUTPUT_TOKENS = 4_000;

export const DEFAULT_REFLECTION_MAX_OUTPUT_TOKENS = 2_000;

function readEnvInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ObservationalMemoryConfig {
  observationTokenThreshold: number;
  reflectionTokenThreshold: number;
  recentRawMessageCount: number;
  observationMaxOutputTokens: number;
  reflectionMaxOutputTokens: number;
}

export function resolveObservationalMemoryConfig(
  overrides: Partial<ObservationalMemoryConfig> = {},
): ObservationalMemoryConfig {
  return {
    observationTokenThreshold:
      overrides.observationTokenThreshold ??
      readEnvInt(
        process.env.AGENT_NATIVE_OM_OBSERVATION_TOKEN_THRESHOLD,
        DEFAULT_OBSERVATION_TOKEN_THRESHOLD,
      ),
    reflectionTokenThreshold:
      overrides.reflectionTokenThreshold ??
      readEnvInt(
        process.env.AGENT_NATIVE_OM_REFLECTION_TOKEN_THRESHOLD,
        DEFAULT_REFLECTION_TOKEN_THRESHOLD,
      ),
    recentRawMessageCount:
      overrides.recentRawMessageCount ??
      readEnvInt(
        process.env.AGENT_NATIVE_OM_RECENT_RAW_MESSAGE_COUNT,
        DEFAULT_RECENT_RAW_MESSAGE_COUNT,
      ),
    observationMaxOutputTokens:
      overrides.observationMaxOutputTokens ??
      DEFAULT_OBSERVATION_MAX_OUTPUT_TOKENS,
    reflectionMaxOutputTokens:
      overrides.reflectionMaxOutputTokens ??
      DEFAULT_REFLECTION_MAX_OUTPUT_TOKENS,
  };
}
