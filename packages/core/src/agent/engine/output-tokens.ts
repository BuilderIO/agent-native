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

// ---------------------------------------------------------------------------
// Main interactive chat path
//
// The per-engine defaults above (4096-8192) exist for internal/eval/
// observational-memory callers that intentionally want a small explicit cap.
// The main interactive chat turn (the one the end user is staring at) needs
// real headroom: on long-context or reasoning-heavy turns, a tiny completion
// budget means extended thinking alone can consume the entire response,
// leaving zero tokens for visible text/tool calls ("empty response" bug).
// These helpers give the chat path a much higher floor while staying at or
// under each model's documented ceiling — they never lower the ceiling.
// ---------------------------------------------------------------------------

/** Cap for the first attempt of an interactive chat turn. */
export const MAIN_CHAT_MAX_OUTPUT_TOKENS_CAP = 32_000;
/**
 * Cap used only when retrying a turn that came back with an empty final
 * response (see production-agent.ts's empty-final-response retry). Higher
 * than the first-attempt cap so the retry meaningfully raises the ceiling.
 */
export const EMPTY_RESPONSE_RETRY_MAX_OUTPUT_TOKENS_CAP = 64_000;

/**
 * Resolve the max_output_tokens floor for the first attempt of an
 * interactive chat turn: min(model ceiling, 32K). Always at or above the
 * flat per-engine defaults above, regardless of whether the model is known.
 */
export function resolveMainChatMaxOutputTokens(modelId?: string): number {
  return Math.min(
    getMaxOutputTokensForModel(modelId),
    MAIN_CHAT_MAX_OUTPUT_TOKENS_CAP,
  );
}

/**
 * Resolve the max_output_tokens to use when retrying a turn after an empty
 * final response: min(model ceiling, 64K).
 */
export function resolveEmptyResponseRetryMaxOutputTokens(
  modelId?: string,
): number {
  return Math.min(
    getMaxOutputTokensForModel(modelId),
    EMPTY_RESPONSE_RETRY_MAX_OUTPUT_TOKENS_CAP,
  );
}

// ---------------------------------------------------------------------------
// Extended-thinking budget headroom
//
// Anthropic's `thinking: { type: "enabled", budget_tokens }` config requires
// budget_tokens >= 1024 and STRICTLY LESS THAN max_tokens (confirmed against
// the installed @anthropic-ai/sdk@0.90.0 type defs — see ThinkingConfigEnabled
// in resources/messages/messages.d.ts). budget_tokens counts toward
// max_tokens, so an unclamped large budget can leave too little (or zero)
// room for the actual visible completion. This clamp guarantees at least
// max(8000, 40% of maxOutputTokens) tokens of non-thinking headroom.
//
// Note: this only applies to the explicit numeric-budget "enabled" config.
// Anthropic's `type: "adaptive"` thinking config (used by the
// reasoningEffort -> output_config.effort mapping in anthropic-engine.ts /
// ai-sdk-engine.ts) has NO budget_tokens field at all per the SDK types, so
// there is nothing to clamp there — those callers rely on the raised
// maxOutputTokens ceiling above instead.
// ---------------------------------------------------------------------------

/** Anthropic's documented minimum extended-thinking budget. */
export const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;

/**
 * Clamp a requested Anthropic thinking budget so it leaves guaranteed
 * headroom under `maxOutputTokens` for non-thinking output, and stays within
 * the provider's valid range (>= 1024, < maxOutputTokens).
 */
export function clampThinkingBudgetTokens(
  requestedBudgetTokens: number,
  maxOutputTokens: number,
): number | undefined {
  if (maxOutputTokens <= ANTHROPIC_MIN_THINKING_BUDGET_TOKENS) {
    return undefined;
  }
  const headroom = Math.max(8000, Math.round(0.4 * maxOutputTokens));
  const budgetCapForHeadroom = Math.max(
    ANTHROPIC_MIN_THINKING_BUDGET_TOKENS,
    maxOutputTokens - headroom,
  );
  // budget_tokens must stay strictly below max_tokens per the API contract.
  const strictUpperBound = maxOutputTokens - 1;
  return Math.max(
    ANTHROPIC_MIN_THINKING_BUDGET_TOKENS,
    Math.min(requestedBudgetTokens, budgetCapForHeadroom, strictUpperBound),
  );
}

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
