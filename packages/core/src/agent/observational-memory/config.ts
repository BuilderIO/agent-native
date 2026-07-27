/**
 * Tunable thresholds for Observational Memory compaction.
 *
 * Defaults are conservative and overridable per call. Deploy-level
 * AGENT_NATIVE_* env overrides let an operator dial compaction without a
 * redeploy; an invalid/missing value always falls back to the named default.
 */

/**
 * Once a thread's UNOBSERVED messages exceed this many tokens, the Observer
 * compacts them into a single dense, dated observation entry.
 */
export const DEFAULT_OBSERVATION_TOKEN_THRESHOLD = 30_000;

/**
 * Once the persisted observation log itself exceeds this many tokens, the
 * Reflector condenses the observations into a higher-level reflection.
 */
export const DEFAULT_REFLECTION_TOKEN_THRESHOLD = 40_000;

/**
 * How many of the most-recent thread messages to always keep verbatim in the
 * read-side context (the "recent raw messages" tier). These are never folded
 * into an observation, so the agent always sees the latest turns in full.
 */
export const DEFAULT_RECENT_RAW_MESSAGE_COUNT = 12;

/** Cap on the Observer's output so one observation can't itself blow the budget. */
export const DEFAULT_OBSERVATION_MAX_OUTPUT_TOKENS = 4_000;

/** Cap on the Reflector's output. */
export const DEFAULT_REFLECTION_MAX_OUTPUT_TOKENS = 2_000;

function readEnvInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolved thresholds, applying env overrides over the named defaults. */
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
