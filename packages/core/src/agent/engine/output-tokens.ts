import { getMaxOutputTokensForModel } from "../model-config.js";

const MIN_MAX_OUTPUT_TOKENS = 256;
// The output-token ceiling is model-aware (see MODEL_MAX_OUTPUT_TOKENS in
// model-config.ts): 64K for models documented at 64K (Claude Haiku 4.5 and
// unknown models — the previous global clamp), 128K for models documented
// higher (Claude Fable 5 / Opus 4.8 / Sonnet 5, GPT-5.x). When no model id is
// available the conservative 64K ceiling applies.

// OpenRouter default raised from 1024 (truncation-prone) to 8192.
export const DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS = 8192;
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

export function normalizeMaxOutputTokens(
  value: unknown,
  modelId?: string,
): number | null {
  const parsed = parsePositiveInteger(value);
  if (parsed == null) return null;
  return Math.min(
    getMaxOutputTokensForModel(modelId),
    Math.max(MIN_MAX_OUTPUT_TOKENS, parsed),
  );
}

function envOverrideForEngine(
  engineName: string,
  modelId?: string,
): number | null {
  const provider = engineName.startsWith("ai-sdk:")
    ? engineName.slice("ai-sdk:".length)
    : engineName;
  const providerEnvKey = `AGENT_${provider
    .replace(/[^a-z0-9]+/gi, "_")
    .toUpperCase()}_MAX_OUTPUT_TOKENS`;
  return (
    // guard:allow-env-credential — output-token cap config, not a credential
    normalizeMaxOutputTokens(process.env[providerEnvKey], modelId) ??
    normalizeMaxOutputTokens(process.env.AGENT_MAX_OUTPUT_TOKENS, modelId)
  );
}

export function defaultMaxOutputTokensForEngine(
  engineName: string,
  modelId?: string,
): number {
  const override = envOverrideForEngine(engineName, modelId);
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
  modelId?: string,
): number {
  return (
    normalizeMaxOutputTokens(explicit, modelId) ??
    defaultMaxOutputTokensForEngine(engineName, modelId)
  );
}
