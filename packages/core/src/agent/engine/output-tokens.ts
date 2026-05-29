const MIN_MAX_OUTPUT_TOKENS = 256;
const MAX_MAX_OUTPUT_TOKENS = 32_768;

export const DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS = 4096;
export const DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_BUILDER_MAX_OUTPUT_TOKENS = 8192;

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;
  if (n == null || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

export function normalizeMaxOutputTokens(value: unknown): number | null {
  const parsed = parsePositiveInteger(value);
  if (parsed == null) return null;
  return Math.min(
    MAX_MAX_OUTPUT_TOKENS,
    Math.max(MIN_MAX_OUTPUT_TOKENS, parsed),
  );
}

function envOverrideForEngine(engineName: string): number | null {
  const provider = engineName.startsWith("ai-sdk:")
    ? engineName.slice("ai-sdk:".length)
    : engineName;
  const providerEnvKey = `AGENT_${provider
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase()}_MAX_OUTPUT_TOKENS`;
  return (
    // guard:allow-env-credential — output-token cap config, not a credential
    normalizeMaxOutputTokens(process.env[providerEnvKey]) ??
    normalizeMaxOutputTokens(process.env.AGENT_MAX_OUTPUT_TOKENS)
  );
}

export function defaultMaxOutputTokensForEngine(engineName: string): number {
  const override = envOverrideForEngine(engineName);
  if (override != null) return override;

  if (engineName === "builder") return DEFAULT_BUILDER_MAX_OUTPUT_TOKENS;
  if (engineName === "anthropic" || engineName === "ai-sdk:anthropic") {
    return DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS;
  }
  if (engineName === "ai-sdk:openrouter") {
    return DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS;
  }
  if (engineName.startsWith("ai-sdk:")) {
    return DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS;
  }
  return DEFAULT_AI_SDK_MAX_OUTPUT_TOKENS;
}

export function resolveMaxOutputTokensForEngine(
  engineName: string,
  explicit?: unknown,
): number {
  return (
    normalizeMaxOutputTokens(explicit) ??
    defaultMaxOutputTokensForEngine(engineName)
  );
}
